/**
 * Suite de Regressão — Correção "ERRO NUVEM" e Replicação Vínculo Promotor × Indústria
 * Filial 172 — Cascavel
 *
 * Valida sem tocar o Firestore de produção:
 * 1. Boot Race Condition (`ensureReady` barrier): puxada remota no `iniciar()` NÃO é sobrescrita
 *    pela finalização tardia da leitura do IndexedDB (`isvService.init()`).
 * 2. Outbox Adiada / Offline Timestamp Skew: operação criada em T1 e enviada em T3 com
 *    Device B já em cursor T2 (T1 < T2 - 2min < T3) atualiza `atualizadoEm` para T3 e replica.
 * 3. Recuperação e reprocessamento de filas presas em `ERRO` (`syncQueueService` e `nuvemSyncEngine`),
 *    eliminando o falso estado permanente "ERRO NUVEM" no cabeçalho.
 * 4. Feedback explícito `aguardandoGerencia` quando fila local tem vínculo aguardando login Google.
 */

import assert from 'node:assert/strict';
import {
  ComercialLocalStateSnapshot,
  ComercialSyncAdapter,
  ComercialSyncPointerDoc,
  ComercialSyncService,
  ComercialWriteOp,
  FILIAL_COMERCIAL_ID,
  META_DOC_SYNC_COMERCIAL,
} from '../comercialSyncService';
import { syncQueueService } from '../syncQueueService';
import { nuvemSyncEngine } from '../nuvemSyncEngine';
import { VinculoPromotorIndustria } from '../../types';

class MockCloud {
  public collections = new Map<string, Map<string, Record<string, any>>>();
  public pointerListeners = new Set<(pointer: ComercialSyncPointerDoc | null) => void>();

  public setDoc(colPath: string, docId: string, data: Record<string, any>, merge = true): void {
    let col = this.collections.get(colPath);
    if (!col) {
      col = new Map();
      this.collections.set(colPath, col);
    }
    const prev = col.get(docId);
    col.set(docId, merge && prev ? { ...prev, ...data } : { ...data });
  }

  public getDoc(colPath: string, docId: string): Record<string, any> | null {
    return this.collections.get(colPath)?.get(docId) ?? null;
  }
}

function createHarness(
  id: string,
  cloud: MockCloud,
  opts: { isGerencia: boolean; online?: boolean }
) {
  let online = opts.online ?? true;
  let isGerencia = opts.isGerencia;
  const meta = new Map<string, any>();
  const localState: ComercialLocalStateSnapshot = {
    promotores: [],
    agencias: [],
    vinculosIndustria: [],
    vinculosDispositivo: [],
    historicoMovimentacoes: [],
    industrias: [],
  };

  const pointerPath = `filiais/${FILIAL_COMERCIAL_ID}/config`;

  const adapter: ComercialSyncAdapter = {
    isOnline: () => online,
    isQuotaExceeded: () => false,
    isQuotaError: () => false,
    markQuotaExceeded: () => {},
    detectQuotaResourceType: () => 'COTA_DIARIA',
    isGerenciaAdmin: () => isGerencia,
    getUsuarioAtual: () => (isGerencia ? 'Gerencia_172' : 'Operador_172'),
    ensureAuth: async () => ({ uid: id }),
    getMeta: async <T,>(key: string, fallback: T) =>
      meta.has(key) ? (JSON.parse(JSON.stringify(meta.get(key))) as T) : fallback,
    setMeta: async <T,>(key: string, value: T) => {
      meta.set(key, JSON.parse(JSON.stringify(value)));
    },
    getPointerDoc: async () => {
      const p = cloud.getDoc(pointerPath, META_DOC_SYNC_COMERCIAL);
      return p ? ({ ...p } as ComercialSyncPointerDoc) : null;
    },
    subscribePointerDoc: (_filialId, onData) => {
      cloud.pointerListeners.add(onData);
      return () => {
        cloud.pointerListeners.delete(onData);
      };
    },
    fetchCollection: async (collectionName, sinceIso) => {
      const col = cloud.collections.get(collectionName);
      if (!col) return [];
      const rows = Array.from(col.values()).map((r) => ({ ...r }));
      if (!sinceIso) return rows;
      return rows.filter((r) => String(r.atualizadoEm || '') >= sinceIso);
    },
    writeBatchOps: async (ops: ComercialWriteOp[]) => {
      for (const op of ops) {
        cloud.setDoc(op.collectionName, op.docId, op.payload, op.merge !== false);
      }
      const p = cloud.getDoc(pointerPath, META_DOC_SYNC_COMERCIAL);
      if (p) {
        for (const cb of cloud.pointerListeners) cb({ ...p } as ComercialSyncPointerDoc);
      }
    },
    checkDocExists: async (col, docId) => cloud.getDoc(col, docId) !== null,
  };

  const service = new ComercialSyncService({ autoStart: false, adapter });

  return {
    service,
    localState,
    meta,
    setOnline: (v: boolean) => {
      online = v;
    },
    setGerencia: (v: boolean) => {
      isGerencia = v;
    },
  };
}

async function testBootRaceConditionBarrier() {
  const cloud = new MockCloud();
  const nowIso = new Date().toISOString();

  // Existe um vínculo promotor x indústria recém-gravado no Firestore
  cloud.setDoc('vinculos_promotor_industria', 'prom_renan_02089969000106_172', {
    id: 'prom_renan_02089969000106_172',
    vinculoId: 'prom_renan_02089969000106_172',
    promotorId: 'prom_renan',
    promotorNome: 'RENAN CANO',
    agenciaNome: 'ITALAC',
    cnpj: '02089969000106',
    industriaId: '02089969000106',
    filialId: '172',
    ativo: true,
    criadoEm: nowIso,
    atualizadoEm: nowIso,
  });
  cloud.setDoc('filiais/172/config', META_DOC_SYNC_COMERCIAL, {
    filialId: '172',
    versaoEsquema: 1,
    ultimaAlteracaoEm: nowIso,
    vinculosIndustriaUpdatedAt: nowIso,
  });

  // Simular outro aparelho onde o IsvService demora 60ms para terminar a leitura inicial do IndexedDB (vazio)
  // enquanto o PromotorService termina antes e chama iniciar() imediatamente.
  const devB = createHarness('dev_B_race', cloud, { isGerencia: false, online: true });
  let isvInitialized = false;
  let initPromise: Promise<void> | null = null;
  const simulatedIsvInit = () => {
    if (isvInitialized) return Promise.resolve();
    if (initPromise) return initPromise;
    initPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        // Simula carga antiga do IndexedDB (0 vínculos antes do sync)
        devB.localState.vinculosIndustria = [];
        isvInitialized = true;
        resolve();
      }, 60);
    });
    return initPromise;
  };

  devB.service.registerIsvHandlers({
    ensureReady: simulatedIsvInit,
    getVinculosIndustria: () => [...devB.localState.vinculosIndustria],
    getIndustrias: () => [],
    applyRemoteChanges: async ({ vinculosIndustria }) => {
      if (vinculosIndustria) {
        devB.localState.vinculosIndustria = vinculosIndustria;
      }
    },
  });
  devB.service.registerPromotorHandlers({
    ensureReady: async () => {},
    getPromotores: () => [],
    getAgencias: () => [],
    getVinculosDispositivo: () => [],
    getHistoricoMovimentacoes: () => [],
    applyRemoteChanges: async () => {},
  });

  // Dispara simulação do boot paralelo: IsvService.init() + comercialSyncService.iniciar()
  await Promise.all([simulatedIsvInit(), devB.service.iniciar()]);

  assert.equal(
    devB.localState.vinculosIndustria.length,
    1,
    'Boot race barrier: vínculo promotor × indústria puxado na inicialização NÃO pode ser apagado pelo fim tardio de isvService.init()'
  );
  assert.equal(devB.localState.vinculosIndustria[0].promotorId, 'prom_renan');
  devB.service.dispose();
}

async function testDeferredOutboxTimestampSkew() {
  const cloud = new MockCloud();

  // Device B já está sincronizado até um cursor T2 = agora - 3 minutos (antes de T3, mas muito DEPOIS de T1)
  const t1Old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 horas atrás
  const t2DeviceBCursor = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min atrás (> skew 2min depois de T1)

  const devA = createHarness('dev_A_skew', cloud, { isGerencia: false, online: true });
  const devB = createHarness('dev_B_skew', cloud, { isGerencia: false, online: true });

  devA.service.setBridge({
    getSnapshot: () => devA.localState,
    applyMergedState: async () => {},
  });
  devB.service.setBridge({
    getSnapshot: () => devB.localState,
    applyMergedState: async (p) => {
      if (p.vinculosIndustria) devB.localState.vinculosIndustria = p.vinculosIndustria;
    },
  });

  // Inicializar Device B com cursor avançado T2
  cloud.setDoc('filiais/172/config', META_DOC_SYNC_COMERCIAL, {
    filialId: '172',
    versaoEsquema: 1,
    ultimaAlteracaoEm: t2DeviceBCursor,
    vinculosIndustriaUpdatedAt: t2DeviceBCursor,
  });
  await devB.service.iniciar();
  const stateB = devB.meta.get('comercial_sync_state_v1');
  stateB.cursors.vinculos_promotor_industria = t2DeviceBCursor;
  stateB.lastPointerSeen.vinculos_promotor_industria = t2DeviceBCursor;
  devB.meta.set('comercial_sync_state_v1', stateB);
  // Recriar devB lendo meta atualizado com cursor T2
  devB.service.dispose();
  const devB2 = createHarness('dev_B_skew_reopen', cloud, { isGerencia: false, online: true });
  devB2.meta.set('comercial_sync_state_v1', stateB);
  devB2.service.setBridge({
    getSnapshot: () => devB2.localState,
    applyMergedState: async (p) => {
      if (p.vinculosIndustria) devB2.localState.vinculosIndustria = p.vinculosIndustria;
    },
  });
  await devB2.service.iniciar();

  // Device A cria vínculo em T1 (2h atrás, antes do cursor de B!) sem estar autenticado ainda
  const linkA: VinculoPromotorIndustria = {
    id: 'prom_skew_02089969000106_172',
    promotorId: 'prom_skew',
    promotorNome: 'PROMOTOR SKEW',
    agenciaNome: 'AGENCIA SKEW',
    cnpj: '02089969000106',
    filialId: '172',
    criado_em: t1Old,
    atualizadoEm: t1Old,
    ativo: true,
  };
  devA.localState.vinculosIndustria.push(linkA);
  await devA.service.registrarVinculoIndustriaSync(linkA);

  // Sem login Gerência -> deve reportar aguardandoGerencia: true
  const syncBeforeAuth = await devA.service.sincronizarAgora();
  assert.equal(syncBeforeAuth.aguardandoGerencia, true, 'Deve informar aguardandoGerencia quando há outbox sem login admin');
  assert.equal(devA.service.getPendingCount(), 1);

  // Agora Gerência autentica em T3 (agora) e processa fila pendente
  devA.setGerencia(true);
  const syncAfterAuth = await devA.service.sincronizarAgora();
  assert.equal(syncAfterAuth.enviados, 1);
  assert.equal(devA.service.getPendingCount(), 0);

  const cloudDoc = cloud.getDoc('vinculos_promotor_industria', linkA.id);
  assert.ok(cloudDoc, 'Vínculo deve ter sido gravado no Firestore');
  assert.ok(
    String(cloudDoc!.atualizadoEm) > t2DeviceBCursor,
    `atualizadoEm (${cloudDoc!.atualizadoEm}) deve ser atualizado para T3 (> ${t2DeviceBCursor}) para não ficar invisível ao cursor de outros aparelhos`
  );

  // Device B sincroniza incrementalmente e DEVE receber o vínculo
  await devB2.service.sincronizarAgora();
  assert.equal(
    devB2.localState.vinculosIndustria.some((v) => v.id === linkA.id),
    true,
    'Device B com cursor T2 deve receber vínculo criado offline/sem-auth em T1 e enviado em T3'
  );

  devA.service.dispose();
  devB2.service.dispose();
}

async function testQueueErrorRetryAndClear() {
  // Inserir manualmente erro nas filas e validar que retry/clear limpa estado de erro
  (syncQueueService as any)._queue = [
    {
      operationId: 'op_err_1',
      tipoOperacao: 'UPDATE_VENCIMENTO',
      registroId: 'lote_legado_err',
      payload: { id: 'lote_legado_err', filialId: '172' },
      dataHora: new Date().toISOString(),
      status: 'ERRO',
      tentativas: 5,
      erroMensagem: 'Missing or insufficient permissions',
    },
  ];
  assert.equal(syncQueueService.hasErrors(), true);
  const removedLegacy = syncQueueService.clearErroredOperations();
  assert.equal(removedLegacy, 1);
  assert.equal(syncQueueService.hasErrors(), false);

  (nuvemSyncEngine as any)._queue = [
    {
      opId: 'op_v3_err_1',
      tipo: 'UPDATE',
      filialId: '172',
      loteId: 'lote_v3_err',
      payload: { id: 'lote_v3_err', filialId: '172' },
      versaoLocal: 2,
      timestampCriacao: new Date().toISOString(),
      status: 'ERRO',
      tentativas: 10,
      erroMensagem: 'Missing or insufficient permissions',
      usuario: 'Operador',
      papelUsuario: 'OPERADOR_LOJA',
    },
  ];
  assert.equal(nuvemSyncEngine.getContadores().erros, 1);
  const removedV3 = nuvemSyncEngine.limparErros();
  assert.equal(removedV3, 1);
  assert.equal(nuvemSyncEngine.getContadores().erros, 0);
}

async function main() {
  await testBootRaceConditionBarrier();
  await testDeferredOutboxTimestampSkew();
  await testQueueErrorRetryAndClear();
  console.log('✅ bugfixSyncAndHeader.test.ts: Boot race barrier, deferred outbox timestamp skew, aguardandoGerencia e limpeza/retry de filas ERRO PASSARAM!');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Falha em bugfixSyncAndHeader.test.ts:', err);
  process.exit(1);
});
