/**
 * ISV — DIAGNÓSTICO SOMENTE DE LEITURA DOS DADOS LOCAIS (FILIAL 172)
 *
 * REGRAS ESTRITAS:
 * - SOMENTE LEITURA: nunca chama dbPut, dbPutAll, dbClear, dbDelete, dbSetMeta,
 *   localStorage.setItem, deleteDatabase, setDoc ou qualquer método de inicialização
 *   que possa semear dados (ex.: isvService.init() ou promotorService.init()).
 * - Todas as transações IndexedDB são abertas exclusivamente como 'readonly'.
 */

import { ProdutoSMG } from '../types';
import { getDB, STORES } from './db';
import { isvService } from './isvService';
import { isModoAtualizacaoLocalAtivo } from './localPackageMode';
import { localUpdatePackageService } from './localUpdatePackageService';
import { productRepository } from './productRepository';
import { promotorService } from './promotorService';

export interface StoreDiagnosticCount {
  storeName: string;
  existeNoDb: boolean;
  countIndexedDB: number;
  erroLeitura?: string;
}

export interface ProdutoStoreBreakdown {
  totalProdutosIndexedDB: number;
  comDadosOperacionaisEmbutidos: number;
  comCampos36ColunasPlanosSemObj: number;
  somenteCatalogoResumido: number;
  amostraOrigens: Record<string, number>;
  ultimaAtualizacaoMaisRecente: string | null;
}

export interface MetadataKeySummary {
  key: string;
  resumo: string;
}

export interface LocalStorageKeySummary {
  key: string;
  presente: boolean;
  resumo: string;
}

export interface ComparativoMemoriaVsIndexedDb {
  conjunto: string;
  storeIndexedDB: string;
  quantidadeIndexedDB: number;
  quantidadeMemoria: number;
  servicoInicializado: boolean;
  origemProvavel: string;
  observacao: string;
}

export interface DiagnosticoDadosLocaisRelatorio {
  geradoEmIso: string;
  somenteLeitura: true;
  originAtual: string;
  modoAtualizacaoLocalAtivo: boolean;
  bancosNavegador: Array<{ name: string; version?: number }>;
  dbAtual: {
    nome: string;
    versao: number;
    objectStoresPresentes: string[];
  } | null;
  contagensStores: StoreDiagnosticCount[];
  breakdownProdutos: ProdutoStoreBreakdown;
  metadadosArmazenados: MetadataKeySummary[];
  chavesLocalStorage: LocalStorageKeySummary[];
  comparativoMemoriaVsIdb: ComparativoMemoriaVsIndexedDb[];
  causasIdentificadas: Array<{
    codigo: string;
    severidade: 'CRITICA' | 'ATENCAO' | 'INFO';
    titulo: string;
    evidencia: string;
  }>;
}

/**
 * Classifica um array (ou fluxo) de ProdutoSMG quanto à presença de dados operacionais
 * da BASE RUB (36 colunas), sem modificar nenhum registro.
 */
export function analisarProdutoParaDiagnostico(
  p: Partial<ProdutoSMG> | null | undefined,
  acc: ProdutoStoreBreakdown
): void {
  if (!p || typeof p !== 'object') return;
  acc.totalProdutosIndexedDB++;

  const temDadosOp = Boolean(
    p.dados_operacionais &&
      typeof p.dados_operacionais === 'object' &&
      (p.dados_operacionais.codigo_interno || p.dados_operacionais.nome)
  );

  const temCampos36Planos =
    p.valor_indisponivel !== undefined ||
    p.bloqueio !== undefined ||
    p.transito_entrada !== undefined ||
    p.estoque_indisponivel !== undefined ||
    p.ultima_venda_formatada !== undefined ||
    p.ultima_compra_formatada !== undefined ||
    p.classe_produto !== undefined ||
    p.classe_produto_raiz !== undefined ||
    p.setor_save !== undefined ||
    p.cadeia !== undefined ||
    p.fornecedor_planilha !== undefined ||
    p.autonomia !== undefined ||
    p.autonomia_pedido !== undefined ||
    p.estoque_original_erp !== undefined;

  if (temDadosOp) {
    acc.comDadosOperacionaisEmbutidos++;
    const label = 'BASE_RUB (dados_operacionais completo)';
    acc.amostraOrigens[label] = (acc.amostraOrigens[label] || 0) + 1;
  } else if (temCampos36Planos) {
    acc.comCampos36ColunasPlanosSemObj++;
    const label = 'BASE_RUB (campos 36 col. planos sem dados_operacionais)';
    acc.amostraOrigens[label] = (acc.amostraOrigens[label] || 0) + 1;
  } else {
    acc.somenteCatalogoResumido++;
    const label = 'Catalogo resumido / SMGOI013 / Demo';
    acc.amostraOrigens[label] = (acc.amostraOrigens[label] || 0) + 1;
  }

  if (typeof p.atualizado_em === 'string' && p.atualizado_em.trim()) {
    if (!acc.ultimaAtualizacaoMaisRecente || p.atualizado_em > acc.ultimaAtualizacaoMaisRecente) {
      acc.ultimaAtualizacaoMaisRecente = p.atualizado_em;
    }
  }
}

export function sintetizarCausasDiagnostico(params: {
  comparativo: ComparativoMemoriaVsIndexedDb[];
  breakdownProdutos: ProdutoStoreBreakdown;
  metadadosArmazenados: MetadataKeySummary[];
  countsByStore: Map<string, number>;
}): DiagnosticoDadosLocaisRelatorio['causasIdentificadas'] {
  const causas: DiagnosticoDadosLocaisRelatorio['causasIdentificadas'] = [];
  const { breakdownProdutos, metadadosArmazenados, countsByStore } = params;

  const isvIdbCount = countsByStore.get(STORES.ISV_REGISTROS_OPERACIONAIS) ?? 0;
  const prodIdbCount = countsByStore.get(STORES.PRODUTOS) ?? 0;
  const fornIdbCount = countsByStore.get(STORES.SPCOI007_FORNECEDORES) ?? 0;
  const indIdbCount = countsByStore.get(STORES.INDUSTRIAS) ?? 0;
  const saeouIdbCount = countsByStore.get(STORES.SAEOU060) ?? 0;
  const promIdbCount = countsByStore.get(STORES.PROMOTORES) ?? 0;
  const vincPiIdbCount = countsByStore.get(STORES.VINCULOS_PROMOTOR_INDUSTRIA) ?? 0;

  const isvInit = isvService.isInitialized();
  const promInit = promotorService.isInitialized();

  // 1. Dados existem em STORES.ISV_REGISTROS_OPERACIONAIS, mas IsvService não foi inicializado fora da aba ISV
  if (isvIdbCount > 0 && !isvInit) {
    causas.push({
      codigo: 'ISV_SERVICE_NAO_INICIALIZADO_NO_BOOT',
      severidade: 'CRITICA',
      titulo: `Registros operacionais (${isvIdbCount.toLocaleString('pt-BR')}) EXISTEM no IndexedDB, mas isvService ainda não foi inicializado na aba atual`,
      evidencia: `Store "${STORES.ISV_REGISTROS_OPERACIONAIS}" contém ${isvIdbCount.toLocaleString('pt-BR')} registros gravados, porém isvService.isInitialized() === false. Como isvService.init() só era chamado ao abrir a aba ISV, o painel do pacote exibia 0 em memória antes dessa visita.`,
    });
  }

  // 2. isv_registros_operacionais vazio no IDB, mas STORES.PRODUTOS preserva dados_operacionais completos (36 colunas)
  if (isvIdbCount === 0 && breakdownProdutos.comDadosOperacionaisEmbutidos > 0) {
    causas.push({
      codigo: 'DADOS_36_COL_EMBUTIDOS_EM_PRODUTOS',
      severidade: 'CRITICA',
      titulo: `Dados completos da BASE RUB (${breakdownProdutos.comDadosOperacionaisEmbutidos.toLocaleString('pt-BR')} registros 36 col.) estão preservados dentro da store "${STORES.PRODUTOS}"`,
      evidencia: `A store "${STORES.ISV_REGISTROS_OPERACIONAIS}" possui 0 registros, mas ${breakdownProdutos.comDadosOperacionaisEmbutidos.toLocaleString('pt-BR')} de ${prodIdbCount.toLocaleString('pt-BR')} itens na store "${STORES.PRODUTOS}" carregam o objeto completo "dados_operacionais" (36 colunas). Isso ocorre quando o aparelho baixou a BASE RUB via nuvem (rubSyncService gravava apenas "${STORES.PRODUTOS}") ou quando spcoiSyncService executou limpeza remota da store operacional.`,
    });
  } else if (isvIdbCount === 0 && breakdownProdutos.comCampos36ColunasPlanosSemObj > 0) {
    causas.push({
      codigo: 'CAMPOS_36_COL_PLANOS_EM_PRODUTOS',
      severidade: 'ATENCAO',
      titulo: `Campos das 36 colunas encontrados diretamente nos itens de "${STORES.PRODUTOS}" (${breakdownProdutos.comCampos36ColunasPlanosSemObj.toLocaleString('pt-BR')} itens)`,
      evidencia: `A store "${STORES.ISV_REGISTROS_OPERACIONAIS}" está vazia (0), mas os registros em "${STORES.PRODUTOS}" contêm os campos espelhados das 36 colunas (valor_indisponivel, bloqueio, transito_entrada, classe_produto, etc.).`,
    });
  } else if (isvIdbCount === 0 && prodIdbCount > 0 && breakdownProdutos.somenteCatalogoResumido === prodIdbCount) {
    causas.push({
      codigo: 'SOMENTE_CATALOGO_RESUMIDO_NO_IDB',
      severidade: 'ATENCAO',
      titulo: `Store "${STORES.PRODUTOS}" contém ${prodIdbCount.toLocaleString('pt-BR')} produtos sem objeto "dados_operacionais" (36 colunas)`,
      evidencia: `Nenhum dos ${prodIdbCount.toLocaleString('pt-BR')} produtos na origem atual possui "dados_operacionais" ou campos exclusivos das 36 colunas, indicando catálogo resumido (ou origem diferente do computador onde a planilha de 36 colunas foi importada).`,
    });
  }

  // 3. Mesmo problema afetando SPCOI007 e Vínculos em memória se isvService não iniciou
  if ((fornIdbCount > 0 || indIdbCount > 0 || vincPiIdbCount > 0) && !isvInit) {
    causas.push({
      codigo: 'SPCOI_E_VINCULOS_EM_REPOUSO_IDB',
      severidade: 'CRITICA',
      titulo: `SPCOI007 (${fornIdbCount.toLocaleString('pt-BR')} forn., ${indIdbCount.toLocaleString('pt-BR')} ind.) e ${vincPiIdbCount.toLocaleString('pt-BR')} vínculos existem no IndexedDB, mas aparecem zerados antes de abrir a aba ISV`,
      evidencia: `Os dados do SPCOI007 e vínculos promotor-indústria estão gravados nas stores locais, porém aguardam isvService.init() para subir à memória.`,
    });
  }

  // 4. Promotores e Agências aguardando promotorService.init()
  if (promIdbCount > 0 && !promInit) {
    causas.push({
      codigo: 'PROMOTOR_SERVICE_NAO_INICIALIZADO_NO_BOOT',
      severidade: 'CRITICA',
      titulo: `Promotores (${promIdbCount}) e suas Agências existem no IndexedDB, mas aparecem zerados até abrir Promotores ou ISV`,
      evidencia: `Store "${STORES.PROMOTORES}" contém ${promIdbCount} cadastros gravados, porém promotorService.isInitialized() === false no carregamento inicial.`,
    });
  }

  // 5. SAEOU060
  if (saeouIdbCount > 0 && productRepository.getSaeou060Registros().length === 0) {
    causas.push({
      codigo: 'SAEOU060_IDB_DIVERGENTE_MEMORIA',
      severidade: 'ATENCAO',
      titulo: `SAEOU060 possui ${saeouIdbCount} registros no IndexedDB ainda não refletidos em memória`,
      evidencia: `Store "${STORES.SAEOU060}" possui ${saeouIdbCount} registros, mas productRepository ainda não concluiu ou não notificou o painel.`,
    });
  }

  // 6. Backup legado ou meta_spcoi_sync indicando limpeza remota anterior
  const metaSpcoi = metadadosArmazenados.find((m) => m.key === 'meta_spcoi_sync');
  if (metaSpcoi && metaSpcoi.resumo.includes('LIMPA_AGUARDANDO_IMPORTACAO')) {
    causas.push({
      codigo: 'META_SPCOI_LIMPEZA_REMOTA_DETECTADA',
      severidade: 'ATENCAO',
      titulo: 'Histórico local indica limpeza remota anterior do SPCOI007',
      evidencia: `Chave "meta_spcoi_sync" aponta status LIMPA_AGUARDANDO_IMPORTACAO. No fluxo legado, spcoiSyncService executava dbClear(ISV_REGISTROS_OPERACIONAIS) durante sincronização de limpeza remota.`,
    });
  }

  if (causas.length === 0) {
    causas.push({
      codigo: 'ESTADO_CONSISTENTE',
      severidade: 'INFO',
      titulo: 'Leitura concluída sem divergências estruturais ocultas nesta origem',
      evidencia:
        'As quantidades exibidas correspondem exatamente ao que está gravado nas stores do IndexedDB desta origem.',
    });
  }

  return causas;
}

async function readStoreCountReadOnly(db: IDBDatabase, storeName: string): Promise<StoreDiagnosticCount> {
  if (!db.objectStoreNames.contains(storeName)) {
    return { storeName, existeNoDb: false, countIndexedDB: 0 };
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.count();
      req.onsuccess = () =>
        resolve({ storeName, existeNoDb: true, countIndexedDB: req.result || 0 });
      req.onerror = () =>
        resolve({
          storeName,
          existeNoDb: true,
          countIndexedDB: 0,
          erroLeitura: req.error?.message || 'Erro ao contar registros',
        });
    } catch (e: any) {
      resolve({
        storeName,
        existeNoDb: true,
        countIndexedDB: 0,
        erroLeitura: e?.message || 'Erro ao abrir transação readonly',
      });
    }
  });
}

async function scanProdutosBreakdownReadOnly(db: IDBDatabase): Promise<ProdutoStoreBreakdown> {
  const acc: ProdutoStoreBreakdown = {
    totalProdutosIndexedDB: 0,
    comDadosOperacionaisEmbutidos: 0,
    comCampos36ColunasPlanosSemObj: 0,
    somenteCatalogoResumido: 0,
    amostraOrigens: {},
    ultimaAtualizacaoMaisRecente: null,
  };

  if (!db.objectStoreNames.contains(STORES.PRODUTOS)) {
    return acc;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORES.PRODUTOS, 'readonly');
      const store = tx.objectStore(STORES.PRODUTOS);
      const req = store.openCursor();
      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          analisarProdutoParaDiagnostico(cursor.value as ProdutoSMG, acc);
          cursor.continue();
        } else {
          resolve(acc);
        }
      };
      req.onerror = () => resolve(acc);
    } catch {
      resolve(acc);
    }
  });
}

async function readMetadataSummariesReadOnly(db: IDBDatabase): Promise<MetadataKeySummary[]> {
  if (!db.objectStoreNames.contains(STORES.METADADOS)) return [];

  return new Promise((resolve) => {
    const out: MetadataKeySummary[] = [];
    try {
      const tx = db.transaction(STORES.METADADOS, 'readonly');
      const store = tx.objectStore(STORES.METADADOS);
      const req = store.openCursor();
      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          const item = cursor.value as { key?: string; value?: any };
          const key = String(item?.key || cursor.key || 'desconhecida');
          const val = item?.value;
          let resumo = '';
          if (key === 'backup_legado_smgoi013' && val && typeof val === 'object') {
            resumo = `Backup criado em ${val.criado_em || '?'} | total_produtos=${val.total_produtos ?? (Array.isArray(val.produtos) ? val.produtos.length : 0)} | origem=${val.origem || '?'}`;
          } else if (val && typeof val === 'object') {
            try {
              const compact = JSON.stringify(val);
              resumo = compact.length > 260 ? `${compact.slice(0, 260)}...` : compact;
            } catch {
              resumo = '[Objeto não serializável]';
            }
          } else {
            resumo = String(val);
          }
          out.push({ key, resumo });
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}

function readLocalStorageSummariesReadOnly(): LocalStorageKeySummary[] {
  const keys = [
    'isv_modo_atualizacao_local_v1',
    'cv_metadados_v1',
    'vencimentos_sync_queue_v1',
    'vencimentos_tombstones_v1',
    'nuvem_v3_queue',
    'nuvem_v3_tombstones',
    'firestore_quota_lock_v2',
    'controle_vencimentos_auth_role_v1',
  ];

  if (typeof localStorage === 'undefined') {
    return keys.map((key) => ({ key, presente: false, resumo: 'localStorage indisponível' }));
  }

  return keys.map((key) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) {
        return { key, presente: false, resumo: 'Não definido' };
      }
      if (raw.length > 220) {
        return { key, presente: true, resumo: `${raw.slice(0, 220)}... (${raw.length} chars)` };
      }
      return { key, presente: true, resumo: raw };
    } catch (e: any) {
      return { key, presente: false, resumo: `Erro de leitura: ${e?.message}` };
    }
  });
}

export async function executarDiagnosticoSomenteLeitura(): Promise<DiagnosticoDadosLocaisRelatorio> {
  const originAtual = typeof window !== 'undefined' ? window.location.origin : 'node/ssr';

  let bancosNavegador: Array<{ name: string; version?: number }> = [];
  if (typeof window !== 'undefined' && window.indexedDB && typeof window.indexedDB.databases === 'function') {
    try {
      const dbs = await window.indexedDB.databases();
      bancosNavegador = dbs.map((d) => ({
        name: d.name || '(sem nome)',
        version: d.version,
      }));
    } catch {
      bancosNavegador = [];
    }
  }

  let db: IDBDatabase | null = null;
  try {
    db = await getDB();
  } catch {
    db = null;
  }

  const allStoreNames = Array.from(
    new Set([
      ...Object.values(STORES),
      ...(db ? Array.from(db.objectStoreNames) : []),
    ])
  );

  const contagensStores: StoreDiagnosticCount[] = db
    ? await Promise.all(allStoreNames.map((s) => readStoreCountReadOnly(db!, s)))
    : allStoreNames.map((storeName) => ({
        storeName,
        existeNoDb: false,
        countIndexedDB: 0,
        erroLeitura: 'IndexedDB indisponível',
      }));

  const countsByStore = new Map<string, number>();
  contagensStores.forEach((c) => countsByStore.set(c.storeName, c.countIndexedDB));

  const breakdownProdutos: ProdutoStoreBreakdown = db
    ? await scanProdutosBreakdownReadOnly(db)
    : {
        totalProdutosIndexedDB: 0,
        comDadosOperacionaisEmbutidos: 0,
        comCampos36ColunasPlanosSemObj: 0,
        somenteCatalogoResumido: 0,
        amostraOrigens: {},
        ultimaAtualizacaoMaisRecente: null,
      };

  const metadadosArmazenados = db ? await readMetadataSummariesReadOnly(db) : [];
  const chavesLocalStorage = readLocalStorageSummariesReadOnly();

  const statusPacoteMemoria = localUpdatePackageService.getStatusPacote();

  const comparativoMemoriaVsIdb: ComparativoMemoriaVsIndexedDb[] = [
    {
      conjunto: 'BASE RUB — Catálogo de Produtos',
      storeIndexedDB: STORES.PRODUTOS,
      quantidadeIndexedDB: countsByStore.get(STORES.PRODUTOS) ?? 0,
      quantidadeMemoria: productRepository.getProdutos().length,
      servicoInicializado: productRepository.isLoaded(),
      origemProvavel:
        breakdownProdutos.comDadosOperacionaisEmbutidos > 0
          ? 'BASE RUB (com dados_operacionais embutidos)'
          : breakdownProdutos.comCampos36ColunasPlanosSemObj > 0
          ? 'BASE RUB (campos planos)'
          : 'Catálogo / SMGOI013 / Demo',
      observacao: 'Exibido no cabeçalho (total_produtos) e utilizado na aba Consulta.',
    },
    {
      conjunto: 'BASE RUB — Registros Operacionais (36 col.)',
      storeIndexedDB: STORES.ISV_REGISTROS_OPERACIONAIS,
      quantidadeIndexedDB: countsByStore.get(STORES.ISV_REGISTROS_OPERACIONAIS) ?? 0,
      quantidadeMemoria: statusPacoteMemoria.contagensAtuais.registrosOperacionais,
      servicoInicializado: isvService.isInitialized(),
      origemProvavel:
        (countsByStore.get(STORES.ISV_REGISTROS_OPERACIONAIS) ?? 0) > 0
          ? `Store "${STORES.ISV_REGISTROS_OPERACIONAIS}"`
          : breakdownProdutos.comDadosOperacionaisEmbutidos > 0
          ? `Embutido dentro de "${STORES.PRODUTOS}" (dados_operacionais)`
          : 'Ausente nesta origem',
      observacao: !isvService.isInitialized()
        ? 'isvService ainda não inicializado nesta sessão antes de abrir a aba ISV.'
        : 'isvService inicializado.',
    },
    {
      conjunto: 'SPCOI007 — Fornecedores',
      storeIndexedDB: STORES.SPCOI007_FORNECEDORES,
      quantidadeIndexedDB: countsByStore.get(STORES.SPCOI007_FORNECEDORES) ?? 0,
      quantidadeMemoria: statusPacoteMemoria.contagensAtuais.fornecedores,
      servicoInicializado: isvService.isInitialized(),
      origemProvavel: `Store "${STORES.SPCOI007_FORNECEDORES}"`,
      observacao: !isvService.isInitialized() ? 'Aguardando isvService.init().' : 'Carregado.',
    },
    {
      conjunto: 'SPCOI007 — Indústrias',
      storeIndexedDB: STORES.INDUSTRIAS,
      quantidadeIndexedDB: countsByStore.get(STORES.INDUSTRIAS) ?? 0,
      quantidadeMemoria: statusPacoteMemoria.contagensAtuais.industrias,
      servicoInicializado: isvService.isInitialized(),
      origemProvavel: `Store "${STORES.INDUSTRIAS}"`,
      observacao: !isvService.isInitialized() ? 'Aguardando isvService.init().' : 'Carregado.',
    },
    {
      conjunto: 'SAEOU060',
      storeIndexedDB: STORES.SAEOU060,
      quantidadeIndexedDB: countsByStore.get(STORES.SAEOU060) ?? 0,
      quantidadeMemoria: statusPacoteMemoria.contagensAtuais.saeou060,
      servicoInicializado: productRepository.isLoaded(),
      origemProvavel: `Store "${STORES.SAEOU060}"`,
      observacao: 'Carregado no boot via initStorage().',
    },
    {
      conjunto: 'Promotores',
      storeIndexedDB: STORES.PROMOTORES,
      quantidadeIndexedDB: countsByStore.get(STORES.PROMOTORES) ?? 0,
      quantidadeMemoria: statusPacoteMemoria.contagensAtuais.promotores,
      servicoInicializado: promotorService.isInitialized(),
      origemProvavel: `Store "${STORES.PROMOTORES}"`,
      observacao: !promotorService.isInitialized()
        ? 'promotorService ainda não inicializado antes de abrir ISV/Promotores.'
        : `${statusPacoteMemoria.contagensAtuais.promotores} promotores carregados.`,
    },
    {
      conjunto: 'Agências Comerciais (Independentes)',
      storeIndexedDB: STORES.AGENCIAS,
      quantidadeIndexedDB: countsByStore.get(STORES.AGENCIAS) ?? 0,
      quantidadeMemoria: promotorService.getAgencias().length || statusPacoteMemoria.contagensAtuais.agencias,
      servicoInicializado: promotorService.isInitialized(),
      origemProvavel:
        (countsByStore.get(STORES.AGENCIAS) ?? 0) > 0
          ? `Store "${STORES.AGENCIAS}"`
          : 'Derivado dos cadastros de promotores',
      observacao: !promotorService.isInitialized()
        ? 'Aguardando promotorService.init().'
        : `${promotorService.getAgencias().length} agências cadastradas.`,
    },
    {
      conjunto: 'Vínculos Promotor × Indústria',
      storeIndexedDB: STORES.VINCULOS_PROMOTOR_INDUSTRIA,
      quantidadeIndexedDB: countsByStore.get(STORES.VINCULOS_PROMOTOR_INDUSTRIA) ?? 0,
      quantidadeMemoria: isvService.getVinculosPromotorIndustria().length,
      servicoInicializado: isvService.isInitialized(),
      origemProvavel: `Store "${STORES.VINCULOS_PROMOTOR_INDUSTRIA}"`,
      observacao: !isvService.isInitialized() ? 'Aguardando isvService.init().' : 'Carregado.',
    },
    {
      conjunto: 'Vínculos Dispositivo × Promotor',
      storeIndexedDB: STORES.VINCULOS_PROMOTORES,
      quantidadeIndexedDB: countsByStore.get(STORES.VINCULOS_PROMOTORES) ?? 0,
      quantidadeMemoria: promotorService.getVinculos().length,
      servicoInicializado: promotorService.isInitialized(),
      origemProvavel: `Store "${STORES.VINCULOS_PROMOTORES}"`,
      observacao: !promotorService.isInitialized() ? 'Aguardando promotorService.init().' : 'Carregado.',
    },
    {
      conjunto: 'Vencimentos (Firebase Spark)',
      storeIndexedDB: STORES.VENCIMENTOS,
      quantidadeIndexedDB: countsByStore.get(STORES.VENCIMENTOS) ?? 0,
      quantidadeMemoria: productRepository.getVencimentos().length,
      servicoInicializado: productRepository.isLoaded(),
      origemProvavel: `Store "${STORES.VENCIMENTOS}" + Firestore`,
      observacao: 'Preservado independentemente do pacote ZIP.',
    },
    {
      conjunto: 'Vínculos EAN (Firebase Spark)',
      storeIndexedDB: STORES.VINCULOS_EAN,
      quantidadeIndexedDB: countsByStore.get(STORES.VINCULOS_EAN) ?? 0,
      quantidadeMemoria: productRepository.getVinculos().length,
      servicoInicializado: productRepository.isLoaded(),
      origemProvavel: `Store "${STORES.VINCULOS_EAN}" + Firestore`,
      observacao: 'Preservado independentemente do pacote ZIP.',
    },
  ];

  const causasIdentificadas = sintetizarCausasDiagnostico({
    comparativo: comparativoMemoriaVsIdb,
    breakdownProdutos,
    metadadosArmazenados,
    countsByStore,
  });

  return {
    geradoEmIso: new Date().toISOString(),
    somenteLeitura: true,
    originAtual,
    modoAtualizacaoLocalAtivo: isModoAtualizacaoLocalAtivo(),
    bancosNavegador,
    dbAtual: db
      ? {
          nome: db.name,
          versao: db.version,
          objectStoresPresentes: Array.from(db.objectStoreNames),
        }
      : null,
    contagensStores,
    breakdownProdutos,
    metadadosArmazenados,
    chavesLocalStorage,
    comparativoMemoriaVsIdb,
    causasIdentificadas,
  };
}
