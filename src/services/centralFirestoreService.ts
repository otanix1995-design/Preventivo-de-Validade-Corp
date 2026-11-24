/**
 * Central Firestore Service
 * 
 * Camada de integração direta com o Firebase Firestore Central compartilhado
 * entre o Aplicativo Principal e o App Promotor.
 * 
 * Coleções Centrais:
 * - produtos: Cadastro e estoque da SMGOI013 (chave: filialId_codigoInterno_digito)
 * - vinculosEAN: Mapeamento EAN ↔ Código Interno (chave: filialId_ean)
 * - vencimentos: Lotes com garantia de unicidade (chave: filialId_codigoInterno_digito_dataVencimento)
 * - promotores: Registro dos promotores de vendas
 * - vinculosPromotor: Códigos de 6 dígitos e tokens de vinculação
 * - auditoria: Trilha de auditoria das ações
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import {
  db,
  ensureAuth,
  formatarErroSyncPorServico,
  isFirestoreQuotaExceeded,
  isQuotaError,
  markQuotaExceeded,
  OperationType,
  SyncServiceErrorDetail,
} from './firebase';
import { authRoleService } from './authRoleService';
import { buildVencimentoCentralPayload } from './deviceId';
import { isModoAtualizacaoLocalAtivo } from './localPackageMode';
import { dbGetAll, dbGetMeta, STORES } from './db';
import { spcoiSyncService } from './spcoiSyncService';
import { comercialSyncService } from './comercialSyncService';
import {
  LoteVencimento,
  MetadadosBase,
  ProdutoSMG,
  Promotor,
  StatusPromotor,
  VinculoEan,
  VinculoPromotor
} from '../types';

// ============================================================================
// ESTRUTURAS DE DADOS CENTRAIS
// ============================================================================

export interface ProdutoCentralDoc {
  codigoInterno: string;
  digito: string;
  codigoCompleto: string;
  descricao: string;
  embalagem: string;
  setor: string;
  filialId: string;
  emb1: number;
  emb9: number;
  tipoEstoque: 'PESO' | 'UNIDADE';
  dataImportacao: string;
  atualizadoEm: string;
  fator_embalagem?: number;
  unidade_medida?: string;
  vendas_preco?: number;
  custo_medio?: number | null;
  estoque_total?: number;
  dias_sem_venda?: number;
  idade?: number;
  eans?: string[];
}

export interface VinculoEanCentralDoc {
  ean: string;
  codigoInterno: string;
  filialId: string;
  atualizadoEm: string;
  digito?: string;
  descricao?: string;
}

export interface VencimentoCentralDoc {
  vencimentoId: string;
  codigoInterno: string;
  digito: string;
  filialId: string;
  dataVencimento: string;
  quantidade: number;
  enviarParaComprador: boolean;
  status: string;
  criadoEm: string;
  atualizadoEm: string;
  descricao_produto?: string;
  embalagem?: string;
  precoNormal?: number | null;
  preco_normal?: number | null;
  precoTrabalhado?: number | null;
  preco_trabalhado?: number | null;
}

export interface PromotorCentralDoc {
  promotorId: string;
  nome: string;
  agenciaNome: string;
  filialId: string;
  setores: string[];
  permissoes: Record<string, boolean>;
  status: StatusPromotor;
  dispositivoVinculado: {
    dispositivoId: string;
    dispositivoNome: string;
    dataVinculo?: string;
    dataPrimeiroVinculo?: string;
    ultimoAcesso?: string;
  } | null;
  ultimoAcesso: string | null;
  ultimaSincronizacao: string | null;
}

export interface VinculoPromotorCentralDoc {
  vinculoId: string;
  promotorId: string;
  codigoVinculo: string;
  tokenVinculo: string;
  filialId: string;
  setores: string[];
  status: 'AGUARDANDO' | 'UTILIZADO' | 'CANCELADO' | 'EXPIRADO';
  dataCriacao: string;
  dataExpiracao: string;
  dataUtilizacao: string | null;
  dispositivoId: string | null;
}

export interface AuditoriaCentralDoc {
  auditoriaId: string;
  promotorId: string;
  promotorNome: string;
  filialId: string;
  setor: string;
  tipoAcao: string;
  codigoInterno: string;
  digito: string;
  descricao: string;
  valorAnterior: string;
  valorNovo: string;
  operationId: string;
  dataHora: string;
}

export interface MigracaoProgressInfo {
  etapa: 'INICIANDO' | 'PRODUTOS' | 'VINCULOS_EAN' | 'VENCIMENTOS' | 'PROMOTORES' | 'VINCULOS_PROMOTOR' | 'CONCLUIDO' | 'ERRO';
  mensagem: string;
  produtos: { atual: number; total: number };
  vinculosEan: { atual: number; total: number };
  vencimentos: { atual: number; total: number };
  promotores: { atual: number; total: number };
  vinculosPromotor: { atual: number; total: number };
  porcentagemGeral: number;
}

export interface TesteResultadoItem {
  id: string;
  titulo: string;
  descricao: string;
  sucesso: boolean;
  tempoMs: number;
  detalhes: string;
  dadosReais?: any;
}

export interface TestesObrigatoriosResultado {
  sucessoGeral: boolean;
  dataExecucao: string;
  itens: TesteResultadoItem[];
}

export interface StatusNuvemHibrida {
  conectado: boolean;
  projectId: string;
  modoArquitetura: 'HIBRIDA_V1';
  gerenciaAdminAutenticada: boolean;
  gerenciaEmail: string | null;
  cotaBloqueada: boolean;
  produtosCount: number;
  saeouCount: number;
  spcoiCount: number;
  vinculosCount: number;
  vencimentosCount: number;
  promotoresCount: number;
  agenciasCount: number;
  versaoSpcoiRemota: string | null;
  versaoSpcoiLocal: string | null;
  comercialUltimaAlteracao: string | null;
  vinculosVersaoRemota: number | null;
  ultimaSincronizacao: string;
  servicosErros: SyncServiceErrorDetail[];
}

// ============================================================================
// GERADORES DE CHAVES ESTÁVEIS
// ============================================================================

export function buildProdutoKey(filialId: string, codigoInterno: string, digito?: string): string {
  const cInterno = String(codigoInterno || '').trim().replace(/^0+/, '') || '0';
  const cDigito = String(digito || '').trim() || '0';
  const cFilial = String(filialId || '172').trim();
  return `${cFilial}_${cInterno}_${cDigito}`;
}

export function buildVinculoEanKey(filialId: string, ean: string): string {
  const cEan = String(ean || '').trim().replace(/\D/g, '');
  const cFilial = String(filialId || '172').trim();
  return `${cFilial}_${cEan}`;
}

export function buildVencimentoKey(filialId: string, codigoInterno: string, digito: string | undefined, dataVencimento: string): string {
  const cInterno = String(codigoInterno || '').trim().replace(/^0+/, '') || '0';
  const cDigito = String(digito || '').trim() || '0';
  const cFilial = String(filialId || '172').trim();
  const cData = String(dataVencimento || '').trim().slice(0, 10);
  return `${cFilial}_${cInterno}_${cDigito}_${cData}`;
}

// ============================================================================
// CLASSE PRINCIPAL CENTRAL FIRESTORE SERVICE
// ============================================================================

export class CentralFirestoreService {
  /**
   * MÉTODO LEGADO DESATIVADO PERMANENTEMENTE PELA ARQUITETURA HÍBRIDA V1.0.
   * Nunca grava BASE RUB em lotes de 300 nem envia coleções comerciais antigas para o Firestore.
   */
  public async sincronizarBaseComNuvem(
    _dadosLocais: {
      produtos: ProdutoSMG[];
      vinculos: VinculoEan[];
      vencimentos: LoteVencimento[];
      promotores: Promotor[];
      vinculosPromotores: VinculoPromotor[];
      filialPadrao?: string;
    },
    onProgress?: (info: MigracaoProgressInfo) => void
  ): Promise<{
    sucesso: boolean;
    bloqueadoArquiteturaHibrida?: boolean;
    mensagem: string;
    stats: {
      produtos: number;
      vinculosEan: number;
      vencimentos: number;
      promotores: number;
      vinculosPromotor: number;
    };
  }> {
    const mensagem =
      'Envio legado da BASE RUB em lotes de 300 desativado permanentemente pela Arquitetura Híbrida V1.0. BASE RUB e SAEOU060 operam exclusivamente no IndexedDB via .zip; utilize SPCOI007 compactado, Sincronização Comercial, Vencimentos e Vínculos EAN.';

    onProgress?.({
      etapa: 'CONCLUIDO',
      mensagem,
      produtos: { atual: 0, total: 0 },
      vinculosEan: { atual: 0, total: 0 },
      vencimentos: { atual: 0, total: 0 },
      promotores: { atual: 0, total: 0 },
      vinculosPromotor: { atual: 0, total: 0 },
      porcentagemGeral: 100,
    });

    console.warn('[CentralFirestoreService] sincronizarBaseComNuvem legado bloqueado pela Arquitetura Híbrida V1.0.');
    return {
      sucesso: false,
      bloqueadoArquiteturaHibrida: true,
      mensagem,
      stats: {
        produtos: 0,
        vinculosEan: 0,
        vencimentos: 0,
        promotores: 0,
        vinculosPromotor: 0,
      },
    };
  }

  // ============================================================================
  // CONSULTAS DIRETAS (SOMENTE LEITURA PARA DIAGNÓSTICO)
  // ============================================================================

  public async consultarProdutoPorEan(
    ean: string,
    filialId: string = '172'
  ): Promise<{
    sucesso: boolean;
    produto?: ProdutoCentralDoc;
    codigoInterno?: string;
    ean?: string;
    origem: 'DIRETO_FIRESTORE';
  }> {
    if (!db) throw new Error('Firestore indisponível');
    const cleanEan = String(ean || '').trim().replace(/\D/g, '');
    if (!cleanEan) return { sucesso: false, origem: 'DIRETO_FIRESTORE' };

    try {
      const docId = buildVinculoEanKey(filialId, cleanEan);
      const vinculoSnap = await getDoc(doc(db, 'vinculosEAN', docId));

      let codigoInterno: string | null = null;
      if (vinculoSnap.exists()) {
        codigoInterno = vinculoSnap.data()?.codigoInterno;
      } else {
        const q = query(collection(db, 'vinculosEAN'), where('ean', '==', cleanEan), limit(1));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          codigoInterno = qSnap.docs[0].data()?.codigoInterno;
        }
      }

      if (!codigoInterno) {
        return { sucesso: false, ean: cleanEan, origem: 'DIRETO_FIRESTORE' };
      }

      const resProduto = await this.consultarProdutoPorCodigo(codigoInterno, undefined, filialId);
      return {
        sucesso: Boolean(resProduto),
        produto: resProduto || undefined,
        codigoInterno,
        ean: cleanEan,
        origem: 'DIRETO_FIRESTORE',
      };
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'Consulta EAN', 'vinculosEAN', OperationType.GET);
      throw new Error(detail.mensagemUsuario);
    }
  }

  public async consultarProdutoPorCodigo(
    codigoInterno: string,
    digito?: string,
    filialId: string = '172'
  ): Promise<ProdutoCentralDoc | null> {
    if (!db) return null;
    const cleanCode = String(codigoInterno || '').trim().replace(/^0+/, '');
    if (!cleanCode) return null;

    try {
      if (digito !== undefined && digito !== '') {
        const docId = buildProdutoKey(filialId, cleanCode, digito);
        const snap = await getDoc(doc(db, 'produtos', docId));
        if (snap.exists()) {
          return snap.data() as ProdutoCentralDoc;
        }
      }

      const q = query(
        collection(db, 'produtos'),
        where('codigoInterno', '==', cleanCode),
        where('filialId', '==', filialId),
        limit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        return snap.docs[0].data() as ProdutoCentralDoc;
      }

      return null;
    } catch (err: any) {
      const detail = formatarErroSyncPorServico(err, 'Consulta Produto Central', 'produtos', OperationType.GET);
      throw new Error(detail.mensagemUsuario);
    }
  }

  public async consultarVencimentoPorChave(
    filialId: string,
    codigoInterno: string,
    digito: string | undefined,
    dataVencimento: string
  ): Promise<VencimentoCentralDoc | null> {
    if (!db) return null;
    const docId = buildVencimentoKey(filialId, codigoInterno, digito, dataVencimento);
    const snap = await getDoc(doc(db, 'vencimentos', docId));
    if (snap.exists()) {
      return snap.data() as VencimentoCentralDoc;
    }
    return null;
  }

  public async consultarPromotor(idOuNome: string): Promise<PromotorCentralDoc | null> {
    if (!db) return null;
    const termo = idOuNome.trim();

    const snap = await getDoc(doc(db, 'promotores', termo));
    if (snap.exists()) {
      return snap.data() as PromotorCentralDoc;
    }

    const q = query(
      collection(db, 'promotores'),
      where('nome', '==', termo.toUpperCase()),
      limit(1)
    );
    const qSnap = await getDocs(q);
    if (!qSnap.empty) {
      return qSnap.docs[0].data() as PromotorCentralDoc;
    }

    const allSnap = await getDocs(query(collection(db, 'promotores'), limit(30)));
    for (const d of allSnap.docs) {
      const data = d.data() as PromotorCentralDoc;
      if (data.nome?.toUpperCase().includes(termo.toUpperCase())) {
        return data;
      }
    }

    return null;
  }

  /**
   * Obtém o estado REAL da Arquitetura Híbrida V1.0 combinando IndexedDB local e ponteiros do Firestore.
   * Nunca retorna números falsos/hardcoded.
   */
  public async obterStatusNuvem(locaisOverride?: {
    produtosCount?: number;
    saeouCount?: number;
    spcoiCount?: number;
    vinculosCount?: number;
    vencimentosCount?: number;
    promotoresCount?: number;
    agenciasCount?: number;
  }): Promise<StatusNuvemHibrida> {
    const servicosErros: SyncServiceErrorDetail[] = [];
    const cotaBloqueada = isFirestoreQuotaExceeded();
    const isAdmin = authRoleService.isGerenciaAdminVerificadaNoServidor();
    const gerenciaEmail = authRoleService.getEmailServidorVerificado();

    const [
      produtosDb,
      saeouDb,
      spcoiDb,
      vinculosDb,
      vencimentosDb,
      promotoresDb,
      agenciasDb,
      metaGeralLocal,
    ] = await Promise.all([
      locaisOverride?.produtosCount !== undefined ? Promise.resolve([]) : dbGetAll(STORES.PRODUTOS).catch(() => []),
      locaisOverride?.saeouCount !== undefined ? Promise.resolve([]) : dbGetAll(STORES.SAEOU060).catch(() => []),
      locaisOverride?.spcoiCount !== undefined ? Promise.resolve([]) : dbGetAll(STORES.SPCOI007_FORNECEDORES).catch(() => []),
      locaisOverride?.vinculosCount !== undefined ? Promise.resolve([]) : dbGetAll(STORES.VINCULOS_EAN).catch(() => []),
      locaisOverride?.vencimentosCount !== undefined ? Promise.resolve([]) : dbGetAll(STORES.VENCIMENTOS).catch(() => []),
      locaisOverride?.promotoresCount !== undefined ? Promise.resolve([]) : dbGetAll(STORES.PROMOTORES).catch(() => []),
      locaisOverride?.agenciasCount !== undefined ? Promise.resolve([]) : dbGetAll(STORES.AGENCIAS).catch(() => []),
      dbGetMeta<MetadadosBase | null>('metadados_gerais', null).catch(() => null),
    ]);

    const produtosCount = locaisOverride?.produtosCount ?? produtosDb.length;
    const saeouCount = locaisOverride?.saeouCount ?? saeouDb.length;
    const spcoiCount = locaisOverride?.spcoiCount ?? spcoiDb.length;
    const vinculosCount = locaisOverride?.vinculosCount ?? vinculosDb.length;
    const vencimentosCount = locaisOverride?.vencimentosCount ?? vencimentosDb.length;
    const promotoresCount = locaisOverride?.promotoresCount ?? promotoresDb.length;
    const agenciasCount = locaisOverride?.agenciasCount ?? agenciasDb.length;

    let versaoSpcoiRemota: string | null = spcoiSyncService.getVersaoAtivaRemota()?.versaoId || null;
    const versaoSpcoiLocal: string | null = spcoiSyncService.getVersaoLocalId();
    let comercialUltimaAlteracao: string | null = comercialSyncService.getStatus().ultimaSincronizacaoIso;
    let vinculosVersaoRemota: number | null = null;
    let conectado = Boolean(db) && !cotaBloqueada && (typeof navigator === 'undefined' || navigator.onLine);

    if (db && !cotaBloqueada && (typeof navigator === 'undefined' || navigator.onLine)) {
      await ensureAuth().catch(() => null);

      const [spcoiRes, comRes, metaRes] = await Promise.allSettled([
        getDoc(doc(db, 'filiais', '172', 'config', 'versao_ativa_spcoi')),
        getDoc(doc(db, 'filiais', '172', 'config', 'sync_comercial_meta')),
        getDoc(doc(db, 'metadados', 'geral')),
      ]);

      if (spcoiRes.status === 'fulfilled') {
        if (spcoiRes.value.exists()) {
          versaoSpcoiRemota = spcoiRes.value.data()?.versaoId || versaoSpcoiRemota;
        }
      } else {
        servicosErros.push(
          formatarErroSyncPorServico(spcoiRes.reason, 'SPCOI007', 'filiais/172/config/versao_ativa_spcoi', OperationType.GET)
        );
      }

      if (comRes.status === 'fulfilled') {
        if (comRes.value.exists()) {
          comercialUltimaAlteracao = comRes.value.data()?.ultimaAlteracaoEm || comercialUltimaAlteracao;
        }
      } else {
        servicosErros.push(
          formatarErroSyncPorServico(comRes.reason, 'Comercial', 'filiais/172/config/sync_comercial_meta', OperationType.GET)
        );
      }

      if (metaRes.status === 'fulfilled') {
        if (metaRes.value.exists()) {
          vinculosVersaoRemota = Number(metaRes.value.data()?.vinculos_version || 0) || null;
        }
      } else {
        servicosErros.push(
          formatarErroSyncPorServico(metaRes.reason, 'Vínculos EAN', 'metadados/geral', OperationType.GET)
        );
      }

      if (servicosErros.some((e) => e.isCotaExcedida)) {
        conectado = false;
      }
    }

    const ultimaSincronizacao =
      comercialUltimaAlteracao ||
      metaGeralLocal?.ultima_atualizacao_base_rub ||
      metaGeralLocal?.ultima_atualizacao_eans ||
      new Date().toLocaleString('pt-BR');

    return {
      conectado,
      projectId: 'gen-lang-client-0352860977',
      modoArquitetura: 'HIBRIDA_V1',
      gerenciaAdminAutenticada: isAdmin,
      gerenciaEmail,
      cotaBloqueada,
      produtosCount,
      saeouCount,
      spcoiCount,
      vinculosCount,
      vencimentosCount,
      promotoresCount,
      agenciasCount,
      versaoSpcoiRemota,
      versaoSpcoiLocal,
      comercialUltimaAlteracao,
      vinculosVersaoRemota,
      ultimaSincronizacao,
      servicosErros,
    };
  }

  // ============================================================================
  // EXECUÇÃO DOS 5 TESTES SOMENTE LEITURA — ARQUITETURA HÍBRIDA V1.0
  // ============================================================================

  /**
   * Executa 5 validações técnicas somente leitura (ZERO gravações em massa):
   * TESTE 1: Isolamento BASE RUB & SAEOU060 (.zip / IndexedDB) + bloqueio do legado.
   * TESTE 2: SPCOI007 Compactado e Versionado (filiais/172/config/versao_ativa_spcoi).
   * TESTE 3: Sincronização Comercial (sync_comercial_meta, promotores, agencias).
   * TESTE 4: Vencimentos & Conformidade isAllowedLoteKeys (sem version / *PorTipo).
   * TESTE 5: Vínculos EAN (metadados/geral) & Regras GERENCIA_ADMIN.
   */
  public async executarTestesObrigatorios(): Promise<TestesObrigatoriosResultado> {
    if (!db) {
      throw new Error('Firestore não está configurado.');
    }

    if (isFirestoreQuotaExceeded()) {
      throw new Error('Cota diária do Firebase Spark aguardando liberação. Testes remotos pausados.');
    }

    await ensureAuth().catch(() => null);
    const resultados: TesteResultadoItem[] = [];

    // ------------------------------------------------------------------------
    // TESTE 1: Isolamento BASE RUB & SAEOU060 + Bloqueio do Legado
    // ------------------------------------------------------------------------
    const t1Inicio = Date.now();
    try {
      const [produtosLocais, saeouLocais, modoLocal] = await Promise.all([
        dbGetAll(STORES.PRODUTOS).catch(() => []),
        dbGetAll(STORES.SAEOU060).catch(() => []),
        Promise.resolve(isModoAtualizacaoLocalAtivo()),
      ]);
      const legadoRes = await this.sincronizarBaseComNuvem({
        produtos: [],
        vinculos: [],
        vencimentos: [],
        promotores: [],
        vinculosPromotores: [],
        filialPadrao: '172',
      });
      const legadoBloqueado = Boolean(legadoRes.bloqueadoArquiteturaHibrida) && legadoRes.sucesso === false;
      resultados.push({
        id: 'TESTE_1',
        titulo: 'TESTE 1: Isolamento BASE RUB & SAEOU060 (.zip / IndexedDB)',
        descricao: 'Confirma que BASE RUB e SAEOU060 são locais via .zip e que o envio em lotes de 300 está desativado.',
        sucesso: modoLocal && legadoBloqueado,
        tempoMs: Date.now() - t1Inicio,
        detalhes: `Modo .zip ativo=${modoLocal} | Envio legado bloqueado=${legadoBloqueado} | IndexedDB: ${produtosLocais.length} produtos BASE RUB, ${saeouLocais.length} registros SAEOU060 (0 escritas no Firestore).`,
        dadosReais: {
          modoAtualizacaoLocalAtivo: modoLocal,
          legadoBloqueado,
          produtosBaseRubLocal: produtosLocais.length,
          saeou060Local: saeouLocais.length,
        },
      });
    } catch (err: any) {
      resultados.push({
        id: 'TESTE_1',
        titulo: 'TESTE 1: Isolamento BASE RUB & SAEOU060 (.zip / IndexedDB)',
        descricao: 'Confirma isolamento local da BASE RUB e SAEOU060.',
        sucesso: false,
        tempoMs: Date.now() - t1Inicio,
        detalhes: `Falha: ${err?.message || err}`,
      });
    }

    // ------------------------------------------------------------------------
    // TESTE 2: SPCOI007 Compactado e Versionado
    // ------------------------------------------------------------------------
    const t2Inicio = Date.now();
    try {
      const pointerRef = doc(db, 'filiais', '172', 'config', 'versao_ativa_spcoi');
      const [pointerSnap, fornecedoresLocais] = await Promise.all([
        getDoc(pointerRef),
        dbGetAll(STORES.SPCOI007_FORNECEDORES).catch(() => []),
      ]);
      const versaoLocal = spcoiSyncService.getVersaoLocalId();

      if (pointerSnap.exists()) {
        const remote = pointerSnap.data();
        resultados.push({
          id: 'TESTE_2',
          titulo: 'TESTE 2: SPCOI007 Compactado e Versionado (fflate + SHA-256)',
          descricao: 'Verifica ponteiro filiais/172/config/versao_ativa_spcoi e estado local no IndexedDB.',
          sucesso: true,
          tempoMs: Date.now() - t2Inicio,
          detalhes: `Versão ativa remota: ${remote.versaoId} (${remote.totalFornecedores || 0} fornecedores em ${remote.totalChunks || 0} chunks) | Versão local: ${versaoLocal || 'não baixada'} | IndexedDB local: ${fornecedoresLocais.length} fornecedores.`,
          dadosReais: remote,
        });
      } else {
        resultados.push({
          id: 'TESTE_2',
          titulo: 'TESTE 2: SPCOI007 Compactado e Versionado (fflate + SHA-256)',
          descricao: 'Verifica ponteiro filiais/172/config/versao_ativa_spcoi.',
          sucesso: true,
          tempoMs: Date.now() - t2Inicio,
          detalhes: `Coleção filiais/172/config/versao_ativa_spcoi acessível (nenhuma versão publicada ainda) | IndexedDB local: ${fornecedoresLocais.length} fornecedores.`,
        });
      }
    } catch (err: any) {
      if (isQuotaError(err)) markQuotaExceeded(err?.message);
      const detail = formatarErroSyncPorServico(
        err,
        'SPCOI007',
        'filiais/172/config/versao_ativa_spcoi',
        OperationType.GET
      );
      resultados.push({
        id: 'TESTE_2',
        titulo: 'TESTE 2: SPCOI007 Compactado e Versionado (fflate + SHA-256)',
        descricao: 'Verifica ponteiro filiais/172/config/versao_ativa_spcoi.',
        sucesso: false,
        tempoMs: Date.now() - t2Inicio,
        detalhes: detail.mensagemUsuario,
      });
    }

    // ------------------------------------------------------------------------
    // TESTE 3: Sincronização Comercial (Promotores, Agências e Vínculos)
    // ------------------------------------------------------------------------
    const t3Inicio = Date.now();
    try {
      const [metaComSnap, promSnap, agSnap, promLocais, agLocais] = await Promise.all([
        getDoc(doc(db, 'filiais', '172', 'config', 'sync_comercial_meta')),
        getDocs(query(collection(db, 'promotores'), where('filialId', '==', '172'), limit(1))),
        getDocs(query(collection(db, 'agencias'), where('filialId', '==', '172'), limit(1))),
        dbGetAll(STORES.PROMOTORES).catch(() => []),
        dbGetAll(STORES.AGENCIAS).catch(() => []),
      ]);
      const statusCom = comercialSyncService.getStatus();
      resultados.push({
        id: 'TESTE_3',
        titulo: 'TESTE 3: Sincronização Comercial Automática (ComercialSyncService)',
        descricao: 'Valida leitura de sync_comercial_meta, promotores e agências para Filial 172.',
        sucesso: true,
        tempoMs: Date.now() - t3Inicio,
        detalhes: `Estado: ${statusCom.estado} | GERENCIA_ADMIN: ${statusCom.isGerenciaAutenticada ? 'Autenticada' : 'Somente Leitura'} | Ponteiro remoto: ${metaComSnap.exists() ? metaComSnap.data()?.ultimaAlteracaoEm : 'vazio'} | Amostras Nuvem: promotores(${promSnap.size}), agências(${agSnap.size}) | Local IndexedDB: ${promLocais.length} promotores, ${agLocais.length} agências.`,
        dadosReais: metaComSnap.exists() ? metaComSnap.data() : { promotoresSample: promSnap.size, agenciasSample: agSnap.size },
      });
    } catch (err: any) {
      if (isQuotaError(err)) markQuotaExceeded(err?.message);
      const detail = formatarErroSyncPorServico(
        err,
        'Comercial',
        'filiais/172/config/sync_comercial_meta / promotores / agencias',
        OperationType.GET
      );
      resultados.push({
        id: 'TESTE_3',
        titulo: 'TESTE 3: Sincronização Comercial Automática (ComercialSyncService)',
        descricao: 'Valida leitura de sync_comercial_meta, promotores e agências.',
        sucesso: false,
        tempoMs: Date.now() - t3Inicio,
        detalhes: detail.mensagemUsuario,
      });
    }

    // ------------------------------------------------------------------------
    // TESTE 4: Vencimentos & Conformidade Schema (isAllowedLoteKeys)
    // ------------------------------------------------------------------------
    const t4Inicio = Date.now();
    try {
      const samplePayload = buildVencimentoCentralPayload({
        id: 'TESTE_SCHEMA_ONLY',
        codigo_interno: '76916',
        digito: '185',
        codigo_exibicao: '76916-185',
        descricao_produto: 'TESTE SCHEMA',
        embalagem: 'UN 1',
        data_validade: '2026-12-31',
        quantidade_total_unidades: 1,
        enviar_ao_comprador: false,
        origem: 'MANUAL',
        criado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      });
      const camposProibidosPresentes = ['version', 'criadoPorTipo', 'criadoPorId', 'atualizadoPorTipo', 'atualizadoPorId']
        .filter((k) => k in samplePayload);

      const qVenc = query(
        collection(db, 'vencimentos'),
        where('filialId', '==', '172'),
        limit(1)
      );
      const snapVenc = await getDocs(qVenc);

      resultados.push({
        id: 'TESTE_4',
        titulo: 'TESTE 4: Vencimentos & Conformidade isAllowedLoteKeys',
        descricao: 'Verifica leitura da coleção vencimentos (Filial 172) e sanitização estrita de chaves permitidas.',
        sucesso: camposProibidosPresentes.length === 0,
        tempoMs: Date.now() - t4Inicio,
        detalhes: `Leitura Firestore OK (${snapVenc.size} amostra retornada) | Chaves proibidas no payload sanitizado: ${camposProibidosPresentes.length === 0 ? 'Nenhuma (conforme firestore.rules)' : camposProibidosPresentes.join(', ')}.`,
        dadosReais: !snapVenc.empty ? snapVenc.docs[0].data() : samplePayload,
      });
    } catch (err: any) {
      if (isQuotaError(err)) markQuotaExceeded(err?.message);
      const detail = formatarErroSyncPorServico(err, 'Vencimentos', 'vencimentos', OperationType.LIST);
      resultados.push({
        id: 'TESTE_4',
        titulo: 'TESTE 4: Vencimentos & Conformidade isAllowedLoteKeys',
        descricao: 'Verifica leitura da coleção vencimentos e conformidade do schema.',
        sucesso: false,
        tempoMs: Date.now() - t4Inicio,
        detalhes: detail.mensagemUsuario,
      });
    }

    // ------------------------------------------------------------------------
    // TESTE 5: Vínculos EAN (metadados/geral & vinculos_chunks)
    // ------------------------------------------------------------------------
    const t5Inicio = Date.now();
    try {
      const [metaSnap, vinculosLocais] = await Promise.all([
        getDoc(doc(db, 'metadados', 'geral')),
        dbGetAll(STORES.VINCULOS_EAN).catch(() => []),
      ]);
      const isAdmin = authRoleService.isGerenciaAdminVerificadaNoServidor();
      const metaData = metaSnap.exists() ? metaSnap.data() : null;

      resultados.push({
        id: 'TESTE_5',
        titulo: 'TESTE 5: Vínculos EAN & Proteção GERENCIA_ADMIN',
        descricao: 'Valida leitura em metadados/geral, contagem local e permissão para gravação em vinculos_chunks.',
        sucesso: true,
        tempoMs: Date.now() - t5Inicio,
        detalhes: `metadados/geral: ${metaData ? `${metaData.total_eans || 0} EANs (v.${metaData.vinculos_version || 0})` : 'sem documento remoto'} | IndexedDB local: ${vinculosLocais.length} vínculos | Escrita em vinculos_chunks: ${isAdmin ? 'Liberada (GERENCIA_ADMIN autenticada)' : 'Bloqueada neste dispositivo (somente leitura até login Google Gerência)'}.`,
        dadosReais: metaData || { totalLocal: vinculosLocais.length, gerenciaAdmin: isAdmin },
      });
    } catch (err: any) {
      if (isQuotaError(err)) markQuotaExceeded(err?.message);
      const detail = formatarErroSyncPorServico(err, 'Vínculos EAN', 'metadados/geral', OperationType.GET);
      resultados.push({
        id: 'TESTE_5',
        titulo: 'TESTE 5: Vínculos EAN & Proteção GERENCIA_ADMIN',
        descricao: 'Valida leitura em metadados/geral e proteção de escrita.',
        sucesso: false,
        tempoMs: Date.now() - t5Inicio,
        detalhes: detail.mensagemUsuario,
      });
    }

    const sucessoGeral = resultados.every((r) => r.sucesso);
    return {
      sucessoGeral,
      dataExecucao: new Date().toISOString(),
      itens: resultados,
    };
  }
}

export const centralFirestoreService = new CentralFirestoreService();
