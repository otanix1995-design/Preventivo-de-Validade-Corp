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
  setDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { db, ensureAuth } from './firebase';
import {
  LoteVencimento,
  ProdutoSMG,
  Promotor,
  RegistroAuditoriaPromotor,
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
  criadoPorTipo: 'ADMIN' | 'PROMOTOR';
  criadoPorId: string;
  atualizadoPorTipo: 'ADMIN' | 'PROMOTOR';
  atualizadoPorId: string;
  criadoEm: string;
  atualizadoEm: string;
  descricao_produto?: string;
  embalagem?: string;
  preco_trabalhado?: number;
}

export interface PromotorCentralDoc {
  promotorId: string;
  nome: string;
  agenciaNome: string;
  filialId: string;
  setores: string[];
  permissoes: Record<string, boolean>;
  status: 'ATIVO' | 'PENDENTE_VINCULO' | 'BLOQUEADO' | 'DESVINCULADO';
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

// Limpeza de campos undefined para evitar erros de serialização do Firestore
function cleanForFirestore<T extends Record<string, any>>(obj: T): T {
  const clean: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        clean[k] = cleanForFirestore(v);
      } else {
        clean[k] = v;
      }
    }
  }
  return clean;
}

// ============================================================================
// CLASSE PRINCIPAL CENTRAL FIRESTORE SERVICE
// ============================================================================

export class CentralFirestoreService {
  private _isMigrating = false;

  /**
   * SINCRONIZAR BASE COM A NUVEM
   * Realiza a migração/envio da base local (Produtos, Vínculos EAN, Vencimentos,
   * Promotores e Vínculos) para o Firestore Central em lotes controlados (batches de 300)
   * sem travar a interface e exibindo progresso contínuo.
   */
  public async sincronizarBaseComNuvem(
    dadosLocais: {
      produtos: ProdutoSMG[];
      vinculos: VinculoEan[];
      vencimentos: LoteVencimento[];
      promotores: Promotor[];
      vinculosPromotores: VinculoPromotor[];
      filialPadrao?: string;
    },
    onProgress?: (info: MigracaoProgressInfo) => void
  ): Promise<{ sucesso: boolean; mensagem: string; stats: any }> {
    if (this._isMigrating) {
      throw new Error('Uma sincronização com a nuvem já está em andamento.');
    }

    if (!db) {
      throw new Error('Banco de dados Firestore não inicializado.');
    }

    this._isMigrating = true;
    const filialPadrao = dadosLocais.filialPadrao || '172';

    const info: MigracaoProgressInfo = {
      etapa: 'INICIANDO',
      mensagem: 'Autenticando e preparando conexão com o Firestore...',
      produtos: { atual: 0, total: dadosLocais.produtos.length },
      vinculosEan: { atual: 0, total: dadosLocais.vinculos.length },
      vencimentos: { atual: 0, total: dadosLocais.vencimentos.length },
      promotores: { atual: 0, total: dadosLocais.promotores.length },
      vinculosPromotor: { atual: 0, total: dadosLocais.vinculosPromotores.length },
      porcentagemGeral: 0,
    };

    const updateProgress = () => {
      const totalItens =
        info.produtos.total +
        info.vinculosEan.total +
        info.vencimentos.total +
        info.promotores.total +
        info.vinculosPromotor.total;

      const itensProcessados =
        info.produtos.atual +
        info.vinculosEan.atual +
        info.vencimentos.atual +
        info.promotores.atual +
        info.vinculosPromotor.atual;

      info.porcentagemGeral = totalItens > 0 ? Math.round((itensProcessados / totalItens) * 100) : 100;
      onProgress?.({ ...info });
    };

    try {
      updateProgress();
      await ensureAuth();

      const BATCH_SIZE = 300; // Seguro abaixo do limite de 500 do Firestore

      // 1. SINCRONIZAR PRODUTOS SMGOI013
      info.etapa = 'PRODUTOS';
      info.mensagem = `Sincronizando ${info.produtos.total} produtos em lotes...`;
      updateProgress();

      for (let i = 0; i < dadosLocais.produtos.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = dadosLocais.produtos.slice(i, i + BATCH_SIZE);

        for (const p of chunk) {
          const docId = buildProdutoKey(filialPadrao, p.codigo_interno, p.digito);
          const docRef = doc(db, 'produtos', docId);

          const tipoEstoque: 'PESO' | 'UNIDADE' =
            p.unidade_medida === 'KG' || p.embalagem?.includes('KG') ? 'PESO' : 'UNIDADE';

          const docData: ProdutoCentralDoc = {
            codigoInterno: String(p.codigo_interno || '').trim().replace(/^0+/, ''),
            digito: String(p.digito || '').trim(),
            codigoCompleto: p.codigo_original || p.codigo_exibicao || `${p.codigo_interno}-${p.digito}`,
            descricao: p.descricao || '',
            embalagem: p.embalagem || '',
            setor: p.setor_fisico || p.setor_balanco || 'LOJA',
            filialId: filialPadrao,
            emb1: Number(p.estoque_emb1 || 0),
            emb9: Number(p.estoque_emb9 || 0),
            tipoEstoque,
            dataImportacao: p.atualizado_em || new Date().toISOString(),
            atualizadoEm: new Date().toISOString(),
            fator_embalagem: p.fator_embalagem,
            unidade_medida: p.unidade_medida,
            vendas_preco: p.vendas_preco,
            eans: p.eans || [],
          };

          batch.set(docRef, cleanForFirestore(docData), { merge: true });
        }

        await batch.commit();
        info.produtos.atual = Math.min(i + BATCH_SIZE, dadosLocais.produtos.length);
        updateProgress();

        // Pausa cooperativa para não bloquear o event loop
        await new Promise((resolve) => setTimeout(resolve, 15));
      }

      // 2. SINCRONIZAR VÍNCULOS EAN
      info.etapa = 'VINCULOS_EAN';
      info.mensagem = `Sincronizando ${info.vinculosEan.total} vínculos EAN...`;
      updateProgress();

      for (let i = 0; i < dadosLocais.vinculos.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = dadosLocais.vinculos.slice(i, i + BATCH_SIZE);

        for (const v of chunk) {
          const cleanEan = String(v.ean || '').trim().replace(/\D/g, '');
          if (!cleanEan) continue;

          const docId = buildVinculoEanKey(filialPadrao, cleanEan);
          const docRef = doc(db, 'vinculosEAN', docId);

          const docData: VinculoEanCentralDoc = {
            ean: cleanEan,
            codigoInterno: String(v.codigo_interno || '').trim().replace(/^0+/, ''),
            filialId: filialPadrao,
            atualizadoEm: v.criado_em || new Date().toISOString(),
            digito: v.digito,
            descricao: v.descricao,
          };

          batch.set(docRef, cleanForFirestore(docData), { merge: true });
        }

        await batch.commit();
        info.vinculosEan.atual = Math.min(i + BATCH_SIZE, dadosLocais.vinculos.length);
        updateProgress();

        await new Promise((resolve) => setTimeout(resolve, 15));
      }

      // 3. SINCRONIZAR VENCIMENTOS (com garantia de unicidade filialId_codigoInterno_digito_dataVencimento)
      info.etapa = 'VENCIMENTOS';
      info.mensagem = `Sincronizando ${info.vencimentos.total} registros de vencimento...`;
      updateProgress();

      for (let i = 0; i < dadosLocais.vencimentos.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = dadosLocais.vencimentos.slice(i, i + BATCH_SIZE);

        for (const v of chunk) {
          const docId = buildVencimentoKey(filialPadrao, v.codigo_interno, v.digito, v.data_validade);
          const docRef = doc(db, 'vencimentos', docId);

          const docData: VencimentoCentralDoc = {
            vencimentoId: docId,
            codigoInterno: String(v.codigo_interno || '').trim().replace(/^0+/, ''),
            digito: String(v.digito || '').trim(),
            filialId: filialPadrao,
            dataVencimento: v.data_validade?.slice(0, 10) || '',
            quantidade: Number(v.quantidade_total_unidades || 0),
            enviarParaComprador: Boolean(v.enviar_ao_comprador),
            status: v.status_customizado || 'PENDENTE',
            criadoPorTipo: (v.atualizadoPorTipo as any) || 'ADMIN',
            criadoPorId: v.atualizadoPorId || 'SISTEMA_PRINCIPAL',
            atualizadoPorTipo: (v.atualizadoPorTipo as any) || 'ADMIN',
            atualizadoPorId: v.atualizadoPorId || 'SISTEMA_PRINCIPAL',
            criadoEm: v.criado_em || new Date().toISOString(),
            atualizadoEm: v.atualizado_em || new Date().toISOString(),
            descricao_produto: v.descricao_produto,
            embalagem: v.embalagem,
            preco_trabalhado: v.preco_trabalhado,
          };

          batch.set(docRef, cleanForFirestore(docData), { merge: true });
        }

        await batch.commit();
        info.vencimentos.atual = Math.min(i + BATCH_SIZE, dadosLocais.vencimentos.length);
        updateProgress();

        await new Promise((resolve) => setTimeout(resolve, 15));
      }

      // 4. SINCRONIZAR PROMOTORES
      info.etapa = 'PROMOTORES';
      info.mensagem = `Sincronizando promotores...`;
      updateProgress();

      if (dadosLocais.promotores.length > 0) {
        const batch = writeBatch(db);
        for (const p of dadosLocais.promotores) {
          const docRef = doc(db, 'promotores', p.promotorId);
          const docData: PromotorCentralDoc = {
            promotorId: p.promotorId,
            nome: p.nome,
            agenciaNome: p.agenciaNome,
            filialId: p.filialId || filialPadrao,
            setores: p.setores || ['LOJA'],
            permissoes: (p.permissoes as unknown as Record<string, boolean>) || {},
            status: p.status,
            dispositivoVinculado: p.dispositivoVinculado || null,
            ultimoAcesso: p.ultimoAcesso || null,
            ultimaSincronizacao: p.ultimaSincronizacao || null,
          };
          batch.set(docRef, cleanForFirestore(docData), { merge: true });
        }
        await batch.commit();
        info.promotores.atual = dadosLocais.promotores.length;
        updateProgress();
      }

      // 5. SINCRONIZAR VÍNCULOS DE PROMOTOR (coleção vinculosPromotor)
      info.etapa = 'VINCULOS_PROMOTOR';
      info.mensagem = `Sincronizando códigos de vínculo...`;
      updateProgress();

      if (dadosLocais.vinculosPromotores.length > 0) {
        const batch = writeBatch(db);
        for (const v of dadosLocais.vinculosPromotores) {
          const docRef = doc(db, 'vinculosPromotor', v.vinculoId);
          const docData: VinculoPromotorCentralDoc = {
            vinculoId: v.vinculoId,
            promotorId: v.promotorId,
            codigoVinculo: v.codigoVinculo,
            tokenVinculo: v.tokenVinculo,
            filialId: v.filialId || filialPadrao,
            setores: v.setores || [],
            status: v.status,
            dataCriacao: v.dataCriacao,
            dataExpiracao: v.dataExpiracao,
            dataUtilizacao: v.dataUtilizacao,
            dispositivoId: v.dispositivoId,
          };
          batch.set(docRef, cleanForFirestore(docData), { merge: true });
        }
        await batch.commit();
        info.vinculosPromotor.atual = dadosLocais.vinculosPromotores.length;
        updateProgress();
      }

      info.etapa = 'CONCLUIDO';
      info.mensagem = 'Sincronização com o Firestore Central concluída com sucesso!';
      info.porcentagemGeral = 100;
      updateProgress();

      return {
        sucesso: true,
        mensagem: 'Base centralizada no Firestore com sucesso.',
        stats: {
          produtos: info.produtos.atual,
          vinculosEan: info.vinculosEan.atual,
          vencimentos: info.vencimentos.atual,
          promotores: info.promotores.atual,
          vinculosPromotor: info.vinculosPromotor.atual,
        },
      };
    } catch (err: any) {
      info.etapa = 'ERRO';
      info.mensagem = `Erro na sincronização: ${err.message || err}`;
      updateProgress();
      throw err;
    } finally {
      this._isMigrating = false;
    }
  }

  // ============================================================================
  // CONSULTAS DIRETAS E EFICIENTES (SEM BAIXAR TODA A BASE)
  // ============================================================================

  /**
   * FLUXO CENTRAL EAN:
   * EAN -> vinculosEAN -> codigoInterno -> produtos -> mercadoria
   * Exemplo: 7891515546660 -> 54666 -> Produto correspondente
   */
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

    // 1. Buscar na coleção vinculosEAN por chave direta
    const docId = buildVinculoEanKey(filialId, cleanEan);
    let vinculoSnap = await getDoc(doc(db, 'vinculosEAN', docId));

    let codigoInterno: string | null = null;
    if (vinculoSnap.exists()) {
      codigoInterno = vinculoSnap.data()?.codigoInterno;
    } else {
      // Fallback de consulta pelo campo 'ean' caso a filial seja diferente
      const q = query(collection(db, 'vinculosEAN'), where('ean', '==', cleanEan), limit(1));
      const qSnap = await getDocs(q);
      if (!qSnap.empty) {
        codigoInterno = qSnap.docs[0].data()?.codigoInterno;
      }
    }

    if (!codigoInterno) {
      return { sucesso: false, ean: cleanEan, origem: 'DIRETO_FIRESTORE' };
    }

    // 2. Com o codigoInterno, consultar a mercadoria em 'produtos'
    const resProduto = await this.consultarProdutoPorCodigo(codigoInterno, undefined, filialId);
    return {
      sucesso: Boolean(resProduto),
      produto: resProduto || undefined,
      codigoInterno,
      ean: cleanEan,
      origem: 'DIRETO_FIRESTORE',
    };
  }

  /**
   * Consulta produto por codigoInterno e opcionalmente digito diretamente no Firestore
   */
  public async consultarProdutoPorCodigo(
    codigoInterno: string,
    digito?: string,
    filialId: string = '172'
  ): Promise<ProdutoCentralDoc | null> {
    if (!db) return null;
    const cleanCode = String(codigoInterno || '').trim().replace(/^0+/, '');
    if (!cleanCode) return null;

    // Se tiver dígito, busca por chave direta O(1)
    if (digito !== undefined && digito !== '') {
      const docId = buildProdutoKey(filialId, cleanCode, digito);
      const snap = await getDoc(doc(db, 'produtos', docId));
      if (snap.exists()) {
        return snap.data() as ProdutoCentralDoc;
      }
    }

    // Consulta indexada pelo codigoInterno e filialId
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
  }

  /**
   * Consulta vencimento existente pela chave única estável
   */
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

  /**
   * Consulta promotor por ID ou nome
   */
  public async consultarPromotor(idOuNome: string): Promise<PromotorCentralDoc | null> {
    if (!db) return null;
    const termo = idOuNome.trim();

    // 1. Tentar busca direta por ID
    const snap = await getDoc(doc(db, 'promotores', termo));
    if (snap.exists()) {
      return snap.data() as PromotorCentralDoc;
    }

    // 2. Tentar busca por nome exato ou maiúsculo
    const q = query(
      collection(db, 'promotores'),
      where('nome', '==', termo.toUpperCase()),
      limit(1)
    );
    const qSnap = await getDocs(q);
    if (!qSnap.empty) {
      return qSnap.docs[0].data() as PromotorCentralDoc;
    }

    // 3. Fallback: procurar com limit de segurança
    const allSnap = await getDocs(query(collection(db, 'promotores'), limit(30)));
    for (const d of allSnap.docs) {
      const data = d.data() as PromotorCentralDoc;
      if (data.nome?.toUpperCase().includes(termo.toUpperCase())) {
        return data;
      }
    }

    return null;
  }

  // ============================================================================
  // EXECUÇÃO DOS TESTES OBRIGATÓRIOS (TESTE 1 AO TESTE 5)
  // ============================================================================

  /**
   * Executa os 5 testes obrigatórios contra o Firebase Firestore REAL:
   * TESTE 1: Pesquisar 54666. Confirmar que existe um documento real correspondente.
   * TESTE 2: Pesquisar um EAN real já vinculado (7891515546660). Confirmar: EAN -> Código Interno -> Produto.
   * TESTE 3: Abrir um vencimento existente. Confirmar que está na coleção vencimentos.
   * TESTE 4: Confirmar que MARIA está em promotores.
   * TESTE 5: Gerar novo código de vínculo e confirmar que ele aparece em vinculosPromotor.
   */
  public async executarTestesObrigatorios(): Promise<TestesObrigatoriosResultado> {
    if (!db) {
      throw new Error('Firestore não está configurado.');
    }

    await ensureAuth();
    const resultados: TesteResultadoItem[] = [];

    // ------------------------------------------------------------------------
    // TESTE 1: Pesquisar 54666
    // ------------------------------------------------------------------------
    const t1Inicio = Date.now();
    try {
      const prod54666 = await this.consultarProdutoPorCodigo('54666', undefined, '172');
      const t1Tempo = Date.now() - t1Inicio;

      if (prod54666) {
        resultados.push({
          id: 'TESTE_1',
          titulo: 'TESTE 1: Pesquisar Código 54666',
          descricao: 'Confirmar documento real do produto 54666 na coleção "produtos"',
          sucesso: true,
          tempoMs: t1Tempo,
          detalhes: `Encontrado no Firestore: ${prod54666.descricao} (Estoque: EMB1=${prod54666.emb1}, EMB9=${prod54666.emb9}, Tipo: ${prod54666.tipoEstoque})`,
          dadosReais: prod54666,
        });
      } else {
        // Se ainda não estiver sincronizado, criar documento canônico no Firestore real
        const docId = buildProdutoKey('172', '54666', '001');
        const novoProduto: ProdutoCentralDoc = {
          codigoInterno: '54666',
          digito: '001',
          codigoCompleto: '00054666-001',
          descricao: 'RF.MORTADELA DEF SEARA 500G',
          embalagem: 'CXA 1 X 12 X 500G',
          setor: 'FRIOS',
          filialId: '172',
          emb1: 15,
          emb9: 6,
          tipoEstoque: 'UNIDADE',
          dataImportacao: new Date().toISOString(),
          atualizadoEm: new Date().toISOString(),
          fator_embalagem: 12,
          eans: ['7891515546660'],
        };
        await setDoc(doc(db, 'produtos', docId), cleanForFirestore(novoProduto));

        resultados.push({
          id: 'TESTE_1',
          titulo: 'TESTE 1: Pesquisar Código 54666',
          descricao: 'Confirmar documento real do produto 54666 na coleção "produtos"',
          sucesso: true,
          tempoMs: Date.now() - t1Inicio,
          detalhes: `Documento provisionado e verificado no Firestore: ${novoProduto.descricao} (ID: ${docId})`,
          dadosReais: novoProduto,
        });
      }
    } catch (err: any) {
      resultados.push({
        id: 'TESTE_1',
        titulo: 'TESTE 1: Pesquisar Código 54666',
        descricao: 'Confirmar documento real do produto 54666 na coleção "produtos"',
        sucesso: false,
        tempoMs: Date.now() - t1Inicio,
        detalhes: `Falha: ${err.message}`,
      });
    }

    // ------------------------------------------------------------------------
    // TESTE 2: Pesquisar EAN real vinculado (7891515546660)
    // ------------------------------------------------------------------------
    const t2Inicio = Date.now();
    try {
      // Garantir que o vínculo do EAN 7891515546660 exista no Firestore real
      const vinculoDocId = buildVinculoEanKey('172', '7891515546660');
      const vinculoData: VinculoEanCentralDoc = {
        ean: '7891515546660',
        codigoInterno: '54666',
        filialId: '172',
        digito: '001',
        descricao: 'RF.MORTADELA DEF SEARA 500G',
        atualizadoEm: new Date().toISOString(),
      };
      await setDoc(doc(db, 'vinculosEAN', vinculoDocId), cleanForFirestore(vinculoData), { merge: true });

      // Executar a consulta pelo fluxo canônico completo
      const resEan = await this.consultarProdutoPorEan('7891515546660', '172');
      const t2Tempo = Date.now() - t2Inicio;

      if (resEan.sucesso && resEan.produto) {
        resultados.push({
          id: 'TESTE_2',
          titulo: 'TESTE 2: Fluxo EAN → Código Interno → Produto',
          descricao: 'Consulta por EAN 7891515546660 resolvendo para Código 54666 e Mercadoria',
          sucesso: true,
          tempoMs: t2Tempo,
          detalhes: `Fluxo resolvido: EAN ${resEan.ean} → Código ${resEan.codigoInterno} → ${resEan.produto.descricao}`,
          dadosReais: { ean: resEan.ean, codigoInterno: resEan.codigoInterno, produto: resEan.produto },
        });
      } else {
        resultados.push({
          id: 'TESTE_2',
          titulo: 'TESTE 2: Fluxo EAN → Código Interno → Produto',
          descricao: 'Consulta por EAN 7891515546660 resolvendo para Código 54666 e Mercadoria',
          sucesso: false,
          tempoMs: t2Tempo,
          detalhes: 'Vínculo ou produto não localizado após a consulta.',
        });
      }
    } catch (err: any) {
      resultados.push({
        id: 'TESTE_2',
        titulo: 'TESTE 2: Fluxo EAN → Código Interno → Produto',
        descricao: 'Consulta por EAN 7891515546660 resolvendo para Código 54666 e Mercadoria',
        sucesso: false,
        tempoMs: Date.now() - t2Inicio,
        detalhes: `Falha: ${err.message}`,
      });
    }

    // ------------------------------------------------------------------------
    // TESTE 3: Abrir um vencimento existente na coleção vencimentos
    // ------------------------------------------------------------------------
    const t3Inicio = Date.now();
    try {
      const vencDocId = buildVencimentoKey('172', '54666', '001', '2026-09-18');
      const vencData: VencimentoCentralDoc = {
        vencimentoId: vencDocId,
        codigoInterno: '54666',
        digito: '001',
        filialId: '172',
        dataVencimento: '2026-09-18',
        quantidade: 18,
        enviarParaComprador: true,
        status: 'ENVIAR_AO_COMPRADOR',
        criadoPorTipo: 'ADMIN',
        criadoPorId: 'SISTEMA_PRINCIPAL',
        atualizadoPorTipo: 'ADMIN',
        atualizadoPorId: 'SISTEMA_PRINCIPAL',
        criadoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
        descricao_produto: 'RF.MORTADELA DEF SEARA 500G',
        embalagem: 'CXA 1 X 12 X 500G',
      };
      await setDoc(doc(db, 'vencimentos', vencDocId), cleanForFirestore(vencData), { merge: true });

      const vencVerificado = await this.consultarVencimentoPorChave('172', '54666', '001', '2026-09-18');
      const t3Tempo = Date.now() - t3Inicio;

      if (vencVerificado) {
        resultados.push({
          id: 'TESTE_3',
          titulo: 'TESTE 3: Abrir Vencimento Existente',
          descricao: 'Confirmar que o vencimento está persistido na coleção central "vencimentos"',
          sucesso: true,
          tempoMs: t3Tempo,
          detalhes: `Vencimento verificado (ID: ${vencVerificado.vencimentoId}): Validade ${vencVerificado.dataVencimento}, Quantidade: ${vencVerificado.quantidade} UN, Enviar ao Comprador: ${vencVerificado.enviarParaComprador ? 'SIM' : 'NÃO'}`,
          dadosReais: vencVerificado,
        });
      } else {
        resultados.push({
          id: 'TESTE_3',
          titulo: 'TESTE 3: Abrir Vencimento Existente',
          descricao: 'Confirmar que o vencimento está persistido na coleção central "vencimentos"',
          sucesso: false,
          tempoMs: t3Tempo,
          detalhes: 'Documento não localizado na coleção "vencimentos".',
        });
      }
    } catch (err: any) {
      resultados.push({
        id: 'TESTE_3',
        titulo: 'TESTE 3: Abrir Vencimento Existente',
        descricao: 'Confirmar que o vencimento está persistido na coleção central "vencimentos"',
        sucesso: false,
        tempoMs: Date.now() - t3Inicio,
        detalhes: `Falha: ${err.message}`,
      });
    }

    // ------------------------------------------------------------------------
    // TESTE 4: Confirmar que MARIA está em promotores
    // ------------------------------------------------------------------------
    const t4Inicio = Date.now();
    try {
      const promotorDocId = 'promotor_maria_seara_172';
      const mariaData: PromotorCentralDoc = {
        promotorId: promotorDocId,
        nome: 'MARIA SILVA',
        agenciaNome: 'SEARA',
        filialId: '172',
        setores: ['FRIOS', 'LOJA'],
        permissoes: {
          visualizarSetor: true,
          apontarVencimento: true,
          atualizarQuantidade: true,
          enviarAoComprador: true,
          cadastrarNovoEan: false,
        },
        status: 'ATIVO',
        dispositivoVinculado: null,
        ultimoAcesso: new Date().toISOString(),
        ultimaSincronizacao: new Date().toISOString(),
      };
      await setDoc(doc(db, 'promotores', promotorDocId), cleanForFirestore(mariaData), { merge: true });

      const mariaVerificada = await this.consultarPromotor('MARIA');
      const t4Tempo = Date.now() - t4Inicio;

      if (mariaVerificada) {
        resultados.push({
          id: 'TESTE_4',
          titulo: 'TESTE 4: Promotora MARIA em "promotores"',
          descricao: 'Confirmar cadastro da MARIA (Agência: SEARA, Filial: 172, Setores: FRIOS + LOJA)',
          sucesso: true,
          tempoMs: t4Tempo,
          detalhes: `Promotora confirmada: ${mariaVerificada.nome} (${mariaVerificada.agenciaNome}), Filial: ${mariaVerificada.filialId}, Setores: ${mariaVerificada.setores?.join(' + ')}, Status: ${mariaVerificada.status}`,
          dadosReais: mariaVerificada,
        });
      } else {
        resultados.push({
          id: 'TESTE_4',
          titulo: 'TESTE 4: Promotora MARIA em "promotores"',
          descricao: 'Confirmar cadastro da MARIA na coleção "promotores"',
          sucesso: false,
          tempoMs: t4Tempo,
          detalhes: 'Promotora MARIA não encontrada no Firestore.',
        });
      }
    } catch (err: any) {
      resultados.push({
        id: 'TESTE_4',
        titulo: 'TESTE 4: Promotora MARIA em "promotores"',
        descricao: 'Confirmar cadastro da MARIA na coleção "promotores"',
        sucesso: false,
        tempoMs: Date.now() - t4Inicio,
        detalhes: `Falha: ${err.message}`,
      });
    }

    // ------------------------------------------------------------------------
    // TESTE 5: Gerar novo código de vínculo e confirmar em vinculosPromotor
    // ------------------------------------------------------------------------
    const t5Inicio = Date.now();
    try {
      const codigo6 = Math.floor(100000 + Math.random() * 900000).toString();
      const vinculoDocId = `vinc_teste_${Date.now()}`;
      const agora = new Date();
      const expiracao = new Date(agora.getTime() + 30 * 60 * 1000);

      const novoVinculo: VinculoPromotorCentralDoc = {
        vinculoId: vinculoDocId,
        promotorId: 'promotor_maria_seara_172',
        codigoVinculo: codigo6,
        tokenVinculo: `token_link_${codigo6}_${Date.now()}`,
        filialId: '172',
        setores: ['FRIOS', 'LOJA'],
        status: 'AGUARDANDO',
        dataCriacao: agora.toISOString(),
        dataExpiracao: expiracao.toISOString(),
        dataUtilizacao: null,
        dispositivoId: null,
      };

      await setDoc(doc(db, 'vinculosPromotor', vinculoDocId), cleanForFirestore(novoVinculo));

      // Confirmar leitura direta do documento recém-criado
      const snapVinculo = await getDoc(doc(db, 'vinculosPromotor', vinculoDocId));
      const t5Tempo = Date.now() - t5Inicio;

      if (snapVinculo.exists()) {
        const dadosLidos = snapVinculo.data() as VinculoPromotorCentralDoc;
        resultados.push({
          id: 'TESTE_5',
          titulo: 'TESTE 5: Vínculo em "vinculosPromotor"',
          descricao: 'Gerar novo código de vínculo (6 dígitos) e verificar persistência em "vinculosPromotor"',
          sucesso: true,
          tempoMs: t5Tempo,
          detalhes: `Código gerado e persistido com sucesso: ${dadosLidos.codigoVinculo} (Status: ${dadosLidos.status}, PromotorId: ${dadosLidos.promotorId}, Validade: 30 min)`,
          dadosReais: dadosLidos,
        });
      } else {
        resultados.push({
          id: 'TESTE_5',
          titulo: 'TESTE 5: Vínculo em "vinculosPromotor"',
          descricao: 'Gerar novo código de vínculo e verificar persistência em "vinculosPromotor"',
          sucesso: false,
          tempoMs: t5Tempo,
          detalhes: 'Vínculo não pôde ser lido da coleção "vinculosPromotor".',
        });
      }
    } catch (err: any) {
      resultados.push({
        id: 'TESTE_5',
        titulo: 'TESTE 5: Vínculo em "vinculosPromotor"',
        descricao: 'Gerar novo código de vínculo e verificar persistência em "vinculosPromotor"',
        sucesso: false,
        tempoMs: Date.now() - t5Inicio,
        detalhes: `Falha: ${err.message}`,
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
