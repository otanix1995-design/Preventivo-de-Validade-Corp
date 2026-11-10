/**
 * Testes Automatizados Offline — Otimização Definitiva para Firebase Spark Gratuito (Filial 172)
 *
 * IMPORTANTE: Execução 100% OFFLINE com adaptadores simulados (zero gravações/leituras no Firestore real).
 *
 * Cobre integralmente:
 * 1. Detecção específica de esgotamento de cota diária (ESCRITA / LEITURA / COTA_DIARIA)
 *    e distinção de estouro de memória 128 MiB e erros de rede.
 * 2. Persistência do bloqueio de cota SEM expiração automática por relógio (>2h / >24h)
 *    e liberação exclusiva mediante verificação real no servidor (verificarLiberacaoCotaNoServidor).
 * 3. Bloqueio de publicações nas três bases (BASE RUB, SPCOI007, SAEOU060) quando cota bloqueada,
 *    e interrupção imediata (0 retentativas) ao detectar resource-exhausted no meio de um envio.
 * 4. Idempotência com 0 escritas quando a base está inalterada e íntegra no servidor,
 *    e reenvio controlado quando há alteração real ou chunk ausente.
 * 5. Helper de UI para fase QUOTA_EXCEEDED e semAlteracoesPulouEnvio.
 * 6. Eliminação de gravações legadas redundantes na Filial 172 (syncWithCloud / saveProducts / pushCatalogo / pushSaeou060)
 *    e operação local 100% funcional (IndexedDB / memória, vencimentos, vínculos EAN) durante bloqueio de cota.
 */

import {
  detectQuotaResourceType,
  getQuotaLockState,
  isFirestoreQuotaExceeded,
  isQuotaError,
  markQuotaExceeded,
  resetQuotaExceeded,
  subscribeQuotaStatus,
  verificarLiberacaoCotaNoServidor,
} from '../firebase';
import {
  PublishAdapter,
} from '../firestorePublishGuard';
import { RubSyncService } from '../rubSyncService';
import { SpcoiSyncService } from '../spcoiSyncService';
import { SaeouSyncService } from '../saeouSyncService';
import { resolverEstadoPublicacaoImportacao } from '../importacaoResultadoHelper';
import { productRepository } from '../productRepository';
import { cloudSyncService } from '../cloudSyncService';
import { centralFirestoreService } from '../centralFirestoreService';
import { syncQueueService } from '../syncQueueService';
import { nuvemSyncEngine } from '../nuvemSyncEngine';
import {
  FornecedorSPCOI007,
  Industria,
  MetadadosBase,
  ProdutoSMG,
  RegistroSaeou060,
} from '../../types';
import { UsuarioOperacional } from '../authRoleService';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${msg}`);
  }
}

interface FakeDocRef {
  path: string;
  id: string;
}

interface FakeCollectionRef {
  path: string;
}

class SparkOfflineFirestoreFake {
  public docs = new Map<string, any>();
  public setDocCalls: Array<{ path: string; data: any }> = [];
  public getDocFromServerCalls: string[] = [];
  public txnCalls = 0;

  public onSetDoc?: (path: string, data: any) => Promise<void> | void;

  public resetCounters(): void {
    this.setDocCalls = [];
    this.getDocFromServerCalls = [];
    this.txnCalls = 0;
  }

  public createAdapter(): PublishAdapter {
    const self = this;
    return {
      db: {} as any,
      ensureAuth: async () => ({ uid: 'spark-test-uid' }),
      isFirestoreQuotaExceeded: () => isFirestoreQuotaExceeded(),
      markQuotaExceeded: (motivo, recurso) => markQuotaExceeded(motivo, recurso),
      isQuotaError: (err) => isQuotaError(err),
      subscribeQuotaStatus: (listener) => subscribeQuotaStatus(listener),
      doc: (_db, ...segments: string[]): FakeDocRef => ({
        path: segments.join('/'),
        id: segments[segments.length - 1],
      }),
      collection: (_db, ...segments: string[]): FakeCollectionRef => ({
        path: segments.join('/'),
      }),
      setDoc: async (ref: FakeDocRef, data: any) => {
        self.setDocCalls.push({ path: ref.path, data });
        if (self.onSetDoc) {
          await self.onSetDoc(ref.path, data);
        }
        self.docs.set(ref.path, JSON.parse(JSON.stringify(data)));
      },
      getDoc: async (ref: FakeDocRef) => {
        const value = self.docs.get(ref.path);
        return {
          exists: () => value !== undefined,
          data: () => (value !== undefined ? JSON.parse(JSON.stringify(value)) : undefined),
        };
      },
      getDocFromServer: async (ref: FakeDocRef) => {
        self.getDocFromServerCalls.push(ref.path);
        const value = self.docs.get(ref.path);
        return {
          exists: () => value !== undefined,
          data: () => (value !== undefined ? JSON.parse(JSON.stringify(value)) : undefined),
        };
      },
      getDocs: async (colRef: FakeCollectionRef) => {
        const prefix = `${colRef.path}/`;
        const matched: Array<{ id: string; data: () => any }> = [];
        self.docs.forEach((val, key) => {
          if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
            matched.push({
              id: key.slice(prefix.length),
              data: () => JSON.parse(JSON.stringify(val)),
            });
          }
        });
        return {
          size: matched.length,
          forEach: (cb: (d: { id: string; data: () => any }) => void) => matched.forEach(cb),
        };
      },
      getCountFromServer: async (colRef: FakeCollectionRef) => {
        const prefix = `${colRef.path}/`;
        let count = 0;
        self.docs.forEach((_val, key) => {
          if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
            count++;
          }
        });
        return { data: () => ({ count }) };
      },
      runTransaction: async (_db, fn) => {
        self.txnCalls++;
        const pendingSets: Array<{ path: string; data: any }> = [];
        const txn = {
          get: async (ref: FakeDocRef) => {
            const value = self.docs.get(ref.path);
            return {
              exists: () => value !== undefined,
              data: () => (value !== undefined ? JSON.parse(JSON.stringify(value)) : undefined),
            };
          },
          set: (ref: FakeDocRef, data: any) => {
            pendingSets.push({ path: ref.path, data: JSON.parse(JSON.stringify(data)) });
          },
        };
        const res = await fn(txn);
        pendingSets.forEach((s) => self.docs.set(s.path, s.data));
        return res;
      },
    };
  }
}

function makeAdmin(): UsuarioOperacional {
  return {
    id: 'usr_admin_172',
    nome: 'Gerência Cascavel',
    matricula: '172999',
    papel: 'GERENCIA_ADMIN',
    filialId: '172',
    ultimoLogin: '2026-11-10T08:00:00.000Z',
  };
}

function makeProdutos(count: number, paddingChars = 240_000): ProdutoSMG[] {
  const pad = 'P'.repeat(paddingChars);
  return Array.from({ length: count }, (_, i) => ({
    id: `rub_prod_${i}`,
    codigo_original: `${50000 + i}-1`,
    codigo_interno: `${50000 + i}`,
    digito: '1',
    codigo_exibicao: `${50000 + i}-1`,
    descricao: `MERCADORIA SPARK TESTE ${i} ${pad}`,
    embalagem: 'UN 1',
    estoque_emb1: 15,
    estoque_emb9: 0,
    estoque_total: 15,
    vendas_qtde_30d: 3,
    dias_sem_venda: 12,
    idade: 20,
    eans: [`78990000${String(i).padStart(5, '0')}`],
    atualizado_em: '2026-11-10T08:00:00.000Z',
  }));
}

function makeSpcoi(count: number, paddingChars = 220_000): {
  fornecedores: FornecedorSPCOI007[];
  industrias: Industria[];
} {
  const pad = 'F'.repeat(paddingChars);
  const fornecedores: FornecedorSPCOI007[] = Array.from({ length: count }, (_, i) => ({
    id: `spcoi_spark_${i}`,
    cnpj: '99888777000166',
    cnpj_formatado: '99.888.777/0001-66',
    razao_social: `INDUSTRIA SPARK LTDA ${pad}`,
    codigo_interno: `${60000 + i}`,
    digito: '4',
    codigo_exibicao: `${60000 + i}-4`,
    descricao_produto: `ITEM SPCOI ${i}`,
    descricao_spcoi: `ITEM SPCOI ${i}`,
    criado_em: '2026-11-10T08:00:00.000Z',
  }));
  const industrias: Industria[] = [
    {
      cnpj: '99888777000166',
      cnpj_formatado: '99.888.777/0001-66',
      razao_social: 'INDUSTRIA SPARK LTDA',
      nome_exibicao: 'INDUSTRIA SPARK LTDA',
      ativo: true,
      total_produtos_loja: count,
      criado_em: '2026-11-10T08:00:00.000Z',
      atualizado_em: '2026-11-10T08:00:00.000Z',
    },
  ];
  return { fornecedores, industrias };
}

function makeSaeou(count: number, paddingChars = 220_000): RegistroSaeou060[] {
  const pad = 'S'.repeat(paddingChars);
  return Array.from({ length: count }, (_, i) => ({
    id: `saeou_spark_${i}`,
    codigo_original: `${70000 + i}-8`,
    codigo_interno: `${70000 + i}`,
    digito: '8',
    codigo_exibicao: `${70000 + i}-8`,
    descricao: `ITEM SAEOU SPARK ${i} ${pad}`,
    embalagem: 'UN 1',
    quantidade: 6,
    estoque_loja: 6,
    data_vencimento: '2026-12-25',
    status_saeou: 'NOVO',
    origem: 'SAEOU060',
    arquivo_origem: 'SAEOU060.xlsx',
    data_importacao: '10/11/2026',
    hora_importacao: '08:00:00',
  }));
}

const dummyMeta: MetadadosBase = {
  filial_numero: '172',
  filial_nome: 'CASCAVEL',
  status_base: 'BASE_RUB',
  total_produtos: 4,
  total_vencimentos: 0,
  total_eans: 0,
  total_saeou060: 0,
};

async function runSparkOptimizationTests() {
  console.log('=== TESTES DE OTIMIZAÇÃO PARA FIREBASE SPARK GRATUITO (FILIAL 172) ===\n');
  resetQuotaExceeded();

  // -------------------------------------------------------------------------
  // CENÁRIO 1: Classificação de erro de cota + bloqueio sem expiração por relógio
  // -------------------------------------------------------------------------
  console.log('[1/6] Detecção de cota Spark, persistência sem expiração temporal e sonda manual...');
  {
    const errWriteQuota = Object.assign(new Error('Quota exceeded for free daily write units'), {
      code: 'resource-exhausted',
    });
    const errReadQuota = new Error('Resource-exhausted: daily quota read limit exceeded');
    const err128Mib = new Error(
      'The query failed since it attempted to use 128.14 MiB (134,367,920 B) when the limit is 128.00 MiB.'
    );
    const errOffline = Object.assign(new Error('Failed to get document because the client is offline.'), {
      code: 'unavailable',
    });

    assert(isQuotaError(errWriteQuota) === true, 'Erro resource-exhausted de escrita deve ser detectado.');
    assert(isQuotaError(errReadQuota) === true, 'Erro de cota de leitura deve ser detectado.');
    assert(isQuotaError(err128Mib) === false, 'Estouro de 128 MiB NÃO é cota diária.');
    assert(isQuotaError(errOffline) === false, 'Erro offline comum NÃO é cota diária.');

    assert(detectQuotaResourceType(errWriteQuota) === 'ESCRITA', 'Deve classificar recurso ESCRITA.');
    assert(detectQuotaResourceType(errReadQuota) === 'LEITURA', 'Deve classificar recurso LEITURA.');
    assert(
      detectQuotaResourceType({ code: 'resource-exhausted' }) === 'COTA_DIARIA',
      'Fallback deve classificar COTA_DIARIA.'
    );

    // Simular storage + window + avanço artificial de 26 horas no Date.now
    const storageMap = new Map<string, string>();
    const origWindow = (globalThis as any).window;
    const origStorage = (globalThis as any).localStorage;
    const origDateNow = Date.now;

    try {
      (globalThis as any).localStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storageMap.set(k, v);
        },
        removeItem: (k: string) => {
          storageMap.delete(k);
        },
      };
      (globalThis as any).window = {};

      let mockNow = 1_762_700_000_000;
      Date.now = () => mockNow;

      markQuotaExceeded('resource-exhausted write quota', 'ESCRITA');
      assert(isFirestoreQuotaExceeded() === true, 'Cota deve ficar bloqueada imediatamente.');
      assert(storageMap.has('firestore_quota_lock_v2'), 'Estado de bloqueio deve ser persistido em localStorage.');

      // Avança 2 horas e depois 26 horas: NUNCA pode desbloquear apenas por tempo!
      mockNow += 2 * 60 * 60 * 1000;
      assert(isFirestoreQuotaExceeded() === true, 'Bloqueio NÃO pode expirar após 2h.');
      mockNow += 24 * 60 * 60 * 1000;
      assert(
        isFirestoreQuotaExceeded() === true,
        'Bloqueio NUNCA deve presumir liberação automática após passar tempo fixo (26h).'
      );

      // Sonda com erro de cota no servidor: mantém bloqueio
      const probeStillExhausted = await verificarLiberacaoCotaNoServidor(async () => {
        throw Object.assign(new Error('Quota limit exceeded'), { code: 'resource-exhausted' });
      });
      assert(probeStillExhausted.liberada === false, 'Sonda com resource-exhausted não pode liberar.');
      assert(isFirestoreQuotaExceeded() === true, 'Bloqueio deve continuar ativo.');

      // Sonda com falha de rede: mantém bloqueio
      const probeNetworkErr = await verificarLiberacaoCotaNoServidor(async () => {
        throw new Error('Network unavailable');
      });
      assert(probeNetworkErr.liberada === false, 'Falha de rede na sonda não pode liberar.');
      assert(isFirestoreQuotaExceeded() === true, 'Bloqueio deve continuar ativo após erro de rede.');

      // Sonda bem-sucedida (1 leitura válida no servidor): libera o bloqueio
      const probeOk = await verificarLiberacaoCotaNoServidor(async () => ({ ok: true }));
      assert(probeOk.liberada === true, 'Sonda bem-sucedida deve liberar a publicação.');
      assert(isFirestoreQuotaExceeded() === false, 'Bloqueio deve ser limpo após confirmação do servidor.');
      assert(!storageMap.has('firestore_quota_lock_v2'), 'Chave de bloqueio deve ser removida do storage.');
    } finally {
      Date.now = origDateNow;
      if (origWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = origWindow;
      if (origStorage === undefined) delete (globalThis as any).localStorage;
      else (globalThis as any).localStorage = origStorage;
      resetQuotaExceeded();
    }

    console.log('  ✓ Detecção, persistência sem auto-expiração e sonda manual validados.');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 2: Bloqueio preventivo & interrupção sem retentativas (3 bases)
  // -------------------------------------------------------------------------
  console.log('[2/6] Bloqueio com cota ativa e corte imediato (0 retentativas) em resource-exhausted...');
  {
    const fake = new SparkOfflineFirestoreFake();
    fake.docs.set('filiais/172/config/versao_ativa_rub', {
      versaoId: 'rub_ativa_segura',
      dataPublicacaoIso: '2026-11-09T10:00:00Z',
      publicadoPor: 'Admin',
      totalProdutos: 100,
      totalChunks: 1,
      checksumBase: 'CHK-RUB-ANT',
    });
    fake.docs.set('filiais/172/config/versao_ativa_spcoi', {
      versaoId: 'spcoi_ativa_segura',
      filialId: '172',
      dataPublicacaoIso: '2026-11-09T10:00:00Z',
      publicadoPor: 'Admin',
      totalFornecedores: 50,
      totalIndustrias: 5,
      totalChunks: 1,
      checksumBase: 'CHK-SPCOI-ANT',
    });
    fake.docs.set('filiais/172/config/versao_ativa_saeou', {
      versaoId: 'saeou_ativa_segura',
      filialId: '172',
      dataPublicacaoIso: '2026-11-09T10:00:00Z',
      publicadoPor: 'Admin',
      totalRegistros: 50,
      totalChunks: 1,
      checksumBase: 'CHK-SAEOU-ANT',
    });

    const rubSvc = new RubSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      setMetaFn: async () => {},
      podePublicarFn: () => ({ permitido: true }),
      getUsuarioFn: makeAdmin,
    });
    const spcoiSvc = new SpcoiSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      setMetaFn: async () => {},
      getUsuarioFn: makeAdmin,
    });
    const saeouSvc = new SaeouSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      setMetaFn: async () => {},
      getUsuarioFn: makeAdmin,
    });

    // 2A. Se bloqueio já ativo antes da publicação -> 0 leituras e 0 escritas
    markQuotaExceeded('Cota diária esgotada', 'ESCRITA');
    const resRubBlocked = await rubSvc.publicarBaseRubCentral(makeProdutos(2, 100), dummyMeta, '172');
    const { fornecedores: spForns, industrias: spInds } = makeSpcoi(2, 100);
    const resSpcoiBlocked = await spcoiSvc.publicarSpcoiCentral(spForns, spInds);
    const resSaeouBlocked = await saeouSvc.publicarSaeouCentral(makeSaeou(2, 100), '172');

    for (const [nome, r] of [
      ['BASE RUB', resRubBlocked],
      ['SPCOI007', resSpcoiBlocked],
      ['SAEOU060', resSaeouBlocked],
    ] as const) {
      assert(r.sucesso === false, `${nome}: não deve publicar com cota bloqueada.`);
      assert(r.estadoPublicacao === 'AGUARDANDO_COTA', `${nome}: esperado AGUARDANDO_COTA, obteve ${r.estadoPublicacao}`);
      assert(r.aguardandoCota === true, `${nome}: aguardandoCota deve ser true.`);
    }
    assert(fake.setDocCalls.length === 0, 'Com cota bloqueada deve realizar ZERO escritas no Firestore.');
    assert(fake.getDocFromServerCalls.length === 0, 'Com cota bloqueada deve realizar ZERO leituras no Firestore.');
    assert(rubSvc.getStatusPublicacao().status === 'BLOQUEADO_COTA', 'RubSyncService deve ficar em BLOQUEADO_COTA.');
    assert(spcoiSvc.getStatus().status === 'BLOQUEADO_COTA', 'SpcoiSyncService deve ficar em BLOQUEADO_COTA.');
    assert(saeouSvc.getStatus().status === 'BLOQUEADO_COTA', 'SaeouSyncService deve ficar em BLOQUEADO_COTA.');

    // 2B. Erro resource-exhausted no meio do upload (chunk_1): para imediatamente sem retentativas
    resetQuotaExceeded();
    fake.resetCounters();
    fake.onSetDoc = async (path) => {
      if (path.endsWith('/chunks/chunk_1')) {
        throw Object.assign(new Error('Resource-exhausted: Write quota limit exceeded'), {
          code: 'resource-exhausted',
        });
      }
    };

    const resMidQuotaRub = await rubSvc.publicarBaseRubCentral(makeProdutos(6), dummyMeta, '172');
    assert(resMidQuotaRub.sucesso === false, 'Falha de cota no chunk_1 deve falhar publicação.');
    assert(
      resMidQuotaRub.estadoPublicacao === 'AGUARDANDO_COTA',
      `Esperado AGUARDANDO_COTA após resource-exhausted, obteve ${resMidQuotaRub.estadoPublicacao}.`
    );
    assert(resMidQuotaRub.aguardandoCota === true, 'aguardandoCota deve ser true após erro de cota.');
    assert(isFirestoreQuotaExceeded() === true, 'Erro de cota durante chunks deve acionar bloqueio global.');
    assert(getQuotaLockState().recurso === 'ESCRITA', 'Recurso de cota detectado deve ser ESCRITA.');
    assert(
      fake.setDocCalls.length <= 2,
      `Deve interromper no primeiro lote (<= 2 chamadas), sem retentativas nem chunks 2..5 (chamou ${fake.setDocCalls.length}x).`
    );
    assert(fake.txnCalls === 0, 'Transação de ativação nunca pode rodar após resource-exhausted.');
    assert(
      fake.docs.get('filiais/172/config/versao_ativa_rub').versaoId === 'rub_ativa_segura',
      'Ponteiro ativo anterior da BASE RUB deve permanecer intacto.'
    );

    // O mesmo para SPCOI007 e SAEOU060
    resetQuotaExceeded();
    fake.resetCounters();
    const { fornecedores: spForns6, industrias: spInds6 } = makeSpcoi(6);
    const resMidQuotaSpcoi = await spcoiSvc.publicarSpcoiCentral(spForns6, spInds6);
    assert(resMidQuotaSpcoi.estadoPublicacao === 'AGUARDANDO_COTA', 'SPCOI007 deve parar em AGUARDANDO_COTA.');
    assert(fake.setDocCalls.length <= 2, 'SPCOI007 deve parar no primeiro lote com 0 retentativas.');
    assert(
      fake.docs.get('filiais/172/config/versao_ativa_spcoi').versaoId === 'spcoi_ativa_segura',
      'Ponteiro SPCOI007 preservado.'
    );

    resetQuotaExceeded();
    fake.resetCounters();
    const resMidQuotaSaeou = await saeouSvc.publicarSaeouCentral(makeSaeou(6), '172');
    assert(resMidQuotaSaeou.estadoPublicacao === 'AGUARDANDO_COTA', 'SAEOU060 deve parar em AGUARDANDO_COTA.');
    assert(fake.setDocCalls.length <= 2, 'SAEOU060 deve parar no primeiro lote com 0 retentativas.');
    assert(
      fake.docs.get('filiais/172/config/versao_ativa_saeou').versaoId === 'saeou_ativa_segura',
      'Ponteiro SAEOU060 preservado.'
    );

    resetQuotaExceeded();
    console.log('  ✓ Bloqueio preventivo e parada imediata com zero retentativas validados.');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 3: Idempotência (0 escritas se base idêntica e íntegra)
  // -------------------------------------------------------------------------
  console.log('[3/6] Idempotência com 0 escritas para bases inalteradas (RUB, SPCOI007, SAEOU060)...');
  {
    const fake = new SparkOfflineFirestoreFake();
    const rubSvc = new RubSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      setMetaFn: async () => {},
      podePublicarFn: () => ({ permitido: true }),
      getUsuarioFn: makeAdmin,
    });
    const spcoiSvc = new SpcoiSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      setMetaFn: async () => {},
      getUsuarioFn: makeAdmin,
    });
    const saeouSvc = new SaeouSyncService({
      autoStart: false,
      adapter: fake.createAdapter(),
      writeTimeoutMs: 500,
      readTimeoutMs: 500,
      setMetaFn: async () => {},
      getUsuarioFn: makeAdmin,
    });

    const prods4 = makeProdutos(4);
    const { fornecedores: sp3, industrias: ind3 } = makeSpcoi(3);
    const saeou3 = makeSaeou(3);

    // 1a publicação: escreve exatamente N chunks + 1 metadados + 1 transação (N + 2)
    fake.resetCounters();
    const r1 = await rubSvc.publicarBaseRubCentral(prods4, dummyMeta, '172');
    assert(r1.sucesso === true && r1.versaoConfirmadaNoServidor === true, '1a publicação RUB deve confirmar.');
    assert(
      fake.setDocCalls.length === (r1.totalChunks || 0) + 1 && fake.txnCalls === 1,
      `RUB 1a pub deve fazer N+1 setDocs (${(r1.totalChunks || 0) + 1}) + 1 transação (fez ${fake.setDocCalls.length} setDocs, ${fake.txnCalls} txns).`
    );

    fake.resetCounters();
    const s1 = await spcoiSvc.publicarSpcoiCentral(sp3, ind3);
    assert(s1.sucesso === true && s1.versaoConfirmadaNoServidor === true, '1a publicação SPCOI007 deve confirmar.');
    assert(
      fake.setDocCalls.length === (s1.totalChunks || 0) + 1 && fake.txnCalls === 1,
      'SPCOI007 1a pub deve fazer exatamente N+2 escritas.'
    );

    fake.resetCounters();
    const o1 = await saeouSvc.publicarSaeouCentral(saeou3, '172');
    assert(o1.sucesso === true && o1.versaoConfirmadaNoServidor === true, '1a publicação SAEOU060 deve confirmar.');
    assert(
      fake.setDocCalls.length === (o1.totalChunks || 0) + 1 && fake.txnCalls === 1,
      'SAEOU060 1a pub deve fazer exatamente N+2 escritas.'
    );

    // 2a publicação com EXATAMENTE os mesmos dados -> 0 escritas nas 3 bases!
    fake.resetCounters();
    const r2 = await rubSvc.publicarBaseRubCentral(prods4, dummyMeta, '172');
    const s2 = await spcoiSvc.publicarSpcoiCentral(sp3, ind3);
    const o2 = await saeouSvc.publicarSaeouCentral(saeou3, '172');

    assert(r2.sucesso === true && r2.semAlteracoesPulouEnvio === true, 'RUB inalterada deve pular reenvio.');
    assert(s2.sucesso === true && s2.semAlteracoesPulouEnvio === true, 'SPCOI007 inalterada deve pular reenvio.');
    assert(o2.sucesso === true && o2.semAlteracoesPulouEnvio === true, 'SAEOU060 inalterada deve pular reenvio.');
    assert(fake.setDocCalls.length === 0, `Reenvio inalterado deve fazer ZERO setDoc (fez ${fake.setDocCalls.length}).`);
    assert(fake.txnCalls === 0, `Reenvio inalterado deve fazer ZERO transações (fez ${fake.txnCalls}).`);

    // 3a publicação após remover 1 chunk no servidor: deve detectar integridade quebrada e reenviar
    fake.docs.delete(`filiais/172/catalogo_rub_versoes/${r1.versaoId}/chunks/chunk_0`);
    fake.resetCounters();
    const r3 = await rubSvc.publicarBaseRubCentral(prods4, dummyMeta, '172');
    assert(r3.sucesso === true && !r3.semAlteracoesPulouEnvio, 'Chunk ausente no servidor deve forçar republicação.');
    assert(fake.setDocCalls.length === (r3.totalChunks || 0) + 1, 'Deve reenviar todos os chunks se servidor estiver incompleto.');

    console.log('  ✓ Idempotência (0 escritas quando idêntica e íntegra) validada nas 3 bases.');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 4: Resolução do estado de UI (QUOTA_EXCEEDED e semAlteracoesPulouEnvio)
  // -------------------------------------------------------------------------
  console.log('[4/6] Helper de interface para QUOTA_EXCEEDED e confirmação sem escritas...');
  {
    const uiQuota = resolverEstadoPublicacaoImportacao(
      'BASE RUB',
      {
        sucesso: false,
        estadoPublicacao: 'AGUARDANDO_COTA',
        versaoConfirmadaNoServidor: false,
        aguardandoCota: true,
        mensagem: 'Cota diária Spark excedida.',
      },
      90,
      '11.700 produtos salvos localmente.'
    );
    assert(uiQuota.phase === 'QUOTA_EXCEEDED', `Esperado phase QUOTA_EXCEEDED, obteve ${uiQuota.phase}.`);
    assert(uiQuota.shouldAutoClose === false, 'Modal de cota não deve fechar automaticamente.');
    assert(uiQuota.progressPercent < 100, 'Progresso não pode ser 100% em erro de cota.');

    const uiZeroWrite = resolverEstadoPublicacaoImportacao(
      'SPCOI007',
      {
        sucesso: true,
        estadoPublicacao: 'CONFIRMADA',
        versaoConfirmadaNoServidor: true,
        semAlteracoesPulouEnvio: true,
        versaoId: 'spcoi_172_v9',
        mensagem: 'Sem alterações',
      },
      25,
      '500 vínculos.'
    );
    assert(uiZeroWrite.phase === 'CONFIRMED', 'Idempotência confirmada deve exibir CONFIRMED.');
    assert(uiZeroWrite.progressPercent === 100, 'Idempotência confirmada deve concluir em 100%.');
    assert(uiZeroWrite.mensagem.includes('0 escritas'), 'Mensagem deve destacar economia de 0 escritas.');

    console.log('  ✓ Estados visuais de cota e economia de escritas validados.');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 5: Eliminação de gravações legadas no productRepository & cloudSyncService
  // -------------------------------------------------------------------------
  console.log('[5/6] Eliminação de escritas legadas em massa e redundantes na Filial 172...');
  {
    let centralSyncArgProdutosLen = -1;
    let centralSyncArgVencimentosLen = -1;
    let centralSyncCalls = 0;
    let syncFullCalls = 0;

    const origSincronizarCentral = centralFirestoreService.sincronizarBaseComNuvem.bind(centralFirestoreService);
    const origSyncFull = cloudSyncService.syncFull.bind(cloudSyncService);

    centralFirestoreService.sincronizarBaseComNuvem = async (params) => {
      centralSyncCalls++;
      centralSyncArgProdutosLen = params.produtos.length;
      centralSyncArgVencimentosLen = params.vencimentos.length;
      return { sucesso: true, mensagem: 'simulado offline', stats: {} };
    };
    cloudSyncService.syncFull = async () => {
      syncFullCalls++;
      return { success: true, message: 'simulado offline' };
    };

    try {
      resetQuotaExceeded();
      await productRepository.saveProducts(makeProdutos(3, 20));
      await productRepository.syncWithCloud();

      assert(syncFullCalls === 1, 'syncWithCloud com cota livre deve delegar ao cloudSyncService.');
      assert(centralSyncCalls === 1, 'centralFirestoreService deve rodar para vínculos/promotores.');
      assert(
        centralSyncArgProdutosLen === 0,
        `Filial 172/BASE_RUB NÃO pode gravar documentos individuais em "produtos" no syncWithCloud (recebeu ${centralSyncArgProdutosLen}).`
      );
      assert(
        centralSyncArgVencimentosLen === 0,
        `syncWithCloud NÃO pode duplicar vencimentos no centralFirestoreService (recebeu ${centralSyncArgVencimentosLen}).`
      );

      // Agora com bloqueio de cota ativo: syncWithCloud não chama nenhum serviço de nuvem!
      syncFullCalls = 0;
      centralSyncCalls = 0;
      markQuotaExceeded('Bloqueio Spark ativo', 'ESCRITA');

      const resQuotaSync = await productRepository.syncWithCloud();
      assert(syncFullCalls === 0, 'Com cota bloqueada, syncWithCloud não pode chamar cloudSyncService.syncFull.');
      assert(
        centralSyncCalls === 0,
        'Com cota bloqueada, syncWithCloud não pode chamar centralFirestoreService.sincronizarBaseComNuvem.'
      );
      assert(
        resQuotaSync.message.toLowerCase().includes('indexeddb') || resQuotaSync.message.toLowerCase().includes('local'),
        'Deve informar operação local via IndexedDB.'
      );

      // Bloqueio legado direto no cloudSyncService mesmo com cota livre
      resetQuotaExceeded();
      const pushedCat = await cloudSyncService.pushCatalogoToCloud(makeProdutos(2, 10), dummyMeta);
      const pushedSaeou = await cloudSyncService.pushSaeou060ToCloud(makeSaeou(2, 10));
      assert(pushedCat === false, 'pushCatalogoToCloud deve recusar gravação legada na Filial 172.');
      assert(pushedSaeou === false, 'pushSaeou060ToCloud deve recusar gravação legada quando Filial 172 usa V3.');
    } finally {
      centralFirestoreService.sincronizarBaseComNuvem = origSincronizarCentral;
      cloudSyncService.syncFull = origSyncFull;
      resetQuotaExceeded();
    }

    console.log('  ✓ Zero gravações legadas redundantes em Filial 172 confirmadas.');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 6: Operação 100% local garantida durante bloqueio de cota Spark
  // -------------------------------------------------------------------------
  console.log('[6/6] Operação local (consulta, EAN, vencimento e fila retida) com cota bloqueada...');
  {
    markQuotaExceeded('Simulação cota Spark esgotada', 'ESCRITA');
    try {
      const sampleProds = makeProdutos(2, 20);
      await productRepository.saveProducts(sampleProds);

      const encontrado = productRepository.findByCodeOrEan('50000-1');
      assert(encontrado !== undefined && encontrado.codigo_interno === '50000', 'Busca local por código deve funcionar com cota bloqueada.');

      const vincRes = await productRepository.vincularEanManualmente('7891234567895', '50000');
      assert(vincRes.success === true, `Vínculo EAN manual local deve funcionar com cota bloqueada: ${vincRes.erro}`);
      assert(productRepository.findByCodeOrEan('7891234567895')?.codigo_interno === '50000', 'Busca por novo EAN vinculado deve funcionar localmente.');

      const loteCriado = await productRepository.addVencimento({
        codigo_interno: '50000',
        digito: '1',
        codigo_exibicao: '50000-1',
        descricao_produto: 'MERCADORIA SPARK TESTE 0',
        embalagem: 'UN 1',
        data_validade: '2026-12-30',
        quantidade_total_unidades: 5,
        observacao: 'Teste offline bloqueio cota',
      });
      assert(Boolean(loteCriado.id), 'Cadastro local de vencimento deve concluir mesmo com cota bloqueada.');
      assert(
        productRepository.getVencimentos().some((v) => v.id === loteCriado.id),
        'Lote cadastrado deve estar acessível na lista local de vencimentos.'
      );

      // Filas de sincronização não podem disparar escrita para nuvem enquanto cota estiver bloqueada
      await syncQueueService.processQueue();
      const resNuvem = await nuvemSyncEngine.processarFila();
      assert(
        resNuvem.processadas === 0 && resNuvem.erros === 0,
        'nuvemSyncEngine deve reter fila sem erros nem gravações enquanto cota estiver bloqueada.'
      );
      assert(
        productRepository.getDiagnosticoBase().totalPersistidos >= 2,
        'Diagnóstico local deve permanecer 100% íntegro.'
      );
    } finally {
      resetQuotaExceeded();
    }

    console.log('  ✓ Operação local completa durante bloqueio de cota verificada.');
  }

  console.log('\n==========================================================================');
  console.log('✅ TODOS OS 6 CENÁRIOS DE OTIMIZAÇÃO SPARK GRATUITO PASSARAM 100% OFFLINE!');
  console.log('==========================================================================\n');
  process.exit(0);
}

runSparkOptimizationTests().catch((err) => {
  console.error('❌ ERRO NA SUÍTE DE OTIMIZAÇÃO SPARK:', err);
  process.exit(1);
});
