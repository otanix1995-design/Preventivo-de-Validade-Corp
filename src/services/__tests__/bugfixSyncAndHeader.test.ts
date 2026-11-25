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
  buildFirestoreMovimentacaoPayload,
  buildFirestorePromotorPayload,
  buildFirestoreVinculoIndustriaPayload,
  ComercialLocalStateSnapshot,
  ComercialSyncAdapter,
  ComercialSyncPointerDoc,
  ComercialSyncService,
  ComercialWriteOp,
  FILIAL_COMERCIAL_ID,
  META_DOC_SYNC_COMERCIAL,
  sanitizeComercialWriteOpPayload,
} from '../comercialSyncService';
import { syncQueueService } from '../syncQueueService';
import { nuvemSyncEngine } from '../nuvemSyncEngine';
import { resetQuotaExceeded } from '../firebase';
import { PERMISSOES_PADRAO_PROMOTOR, Promotor, VinculoPromotorIndustria } from '../../types';

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

async function testPayloadSanitizationNoNullsOrExtraKeys() {
  const promotorSemSetores = {
    promotorId: 'prom_san_1',
    nome: 'PROMOTOR SEM SETORES',
    agenciaNome: '',
    filialId: '172',
    filialNome: 'Cascavel',
    dataCadastro: '2026-11-20T10:00:00.000Z',
    status: undefined,
    permissoes: { podeRegistrarVencimentos: true },
    criadoPor: 'Gerencia',
    atualizadoPor: 'Gerencia',
  } as unknown as Promotor;
  const promPayload = buildFirestorePromotorPayload(promotorSemSetores);
  assert.equal('setores' in promPayload, false, 'Não pode injetar setores: null quando setores é undefined');
  assert.equal('status' in promPayload, false, 'Não pode injetar status: null quando status é undefined');

  const movPayload = buildFirestoreMovimentacaoPayload({
    id: 'mov_san_1',
    tipo: 'PROMOTOR_VINCULADO_AGENCIA',
    dataHora: '2026-11-20T10:00:00.000Z',
    detalhes: 'Teste sanitização',
    realizadoPor: 'Gerencia',
    modoTransferencia: undefined,
    inativacaoOrigem: undefined,
  });
  assert.equal('modoTransferencia' in movPayload, false, 'Não pode injetar modoTransferencia: null');
  assert.equal('inativacaoOrigem' in movPayload, false, 'Não pode injetar inativacaoOrigem: null');

  const dirtyLinkPayload = sanitizeComercialWriteOpPayload('vinculos_promotor_industria', {
    id: 'v_san_1',
    promotorId: 'prom_san_1',
    promotorNome: undefined,
    agenciaNome: undefined,
    cnpj: '02.089.969/0001-06',
    extraForbiddenField: 'hack',
  });
  assert.equal('extraForbiddenField' in dirtyLinkPayload, false, 'Deve remover chaves fora da whitelist');
  assert.equal(typeof dirtyLinkPayload.promotorNome, 'string', 'promotorNome deve ser string (nunca null)');
  assert.equal(typeof dirtyLinkPayload.agenciaNome, 'string', 'agenciaNome deve ser string (nunca null)');

  // buildFirestoreVinculoIndustriaPayload direto
  const directLink = buildFirestoreVinculoIndustriaPayload({
    id: 'v_san_2',
    promotorId: 'prom_san_1',
    promotorNome: 'PROMOTOR',
    agenciaNome: 'AGENCIA TESTE',
    cnpj: '02089969000106',
    filialId: '172',
    criado_em: '2026-11-20T10:00:00.000Z',
    ativo: true,
  });
  assert.equal(directLink.industriaId, '02089969000106');
  assert.equal(directLink.ativo, true);
}

async function testFailedDomainFetchDoesNotAdvanceCursor() {
  const cloud = new MockCloud();
  const pointerIso = '2026-11-24T12:00:00.000Z';
  cloud.setDoc('filiais/172/config', META_DOC_SYNC_COMERCIAL, {
    filialId: '172',
    versaoEsquema: 1,
    ultimaAlteracaoEm: pointerIso,
    promotoresUpdatedAt: pointerIso,
    vinculosIndustriaUpdatedAt: pointerIso,
  });

  const baseHarness = createHarness('dev_fail_domain', cloud, { isGerencia: true, online: true });
  const meta = baseHarness.meta;
  const localState = baseHarness.localState;

  const failingAdapter: ComercialSyncAdapter = {
    isOnline: () => true,
    isQuotaExceeded: () => false,
    isQuotaError: () => false,
    markQuotaExceeded: () => {},
    detectQuotaResourceType: () => 'COTA_DIARIA',
    isGerenciaAdmin: () => true,
    getUsuarioAtual: () => 'Gerencia_172',
    ensureAuth: async () => ({ uid: 'fail_uid' }),
    getMeta: async <T,>(key: string, fallback: T) =>
      meta.has(key) ? (JSON.parse(JSON.stringify(meta.get(key))) as T) : fallback,
    setMeta: async <T,>(key: string, value: T) => {
      meta.set(key, JSON.parse(JSON.stringify(value)));
    },
    getPointerDoc: async () =>
      (cloud.getDoc(`filiais/${FILIAL_COMERCIAL_ID}/config`, META_DOC_SYNC_COMERCIAL) as ComercialSyncPointerDoc) ||
      null,
    subscribePointerDoc: () => () => {},
    fetchCollection: async (colName) => {
      if (colName === 'vinculos_promotor_industria') {
        throw new Error('Missing or insufficient permissions.');
      }
      return [];
    },
    writeBatchOps: async () => {},
    checkDocExists: async () => false,
  };

  const svc = new ComercialSyncService({ autoStart: false, adapter: failingAdapter });
  svc.setBridge({
    getSnapshot: () => localState,
    applyMergedState: async () => {},
  });

  const res = await svc.sincronizarAgora({ reconciliar: true });
  assert.equal(res.sucesso, false, 'Sincronização com falha em domínio NÃO pode reportar sucesso');
  assert.ok(res.erros > 0, 'Deve contabilizar erro de domínio');

  const persisted = meta.get('comercial_sync_state_v1');
  assert.equal(
    persisted?.lastPointerSeen?.vinculos_promotor_industria,
    undefined,
    'Domínio com erro NÃO pode avançar lastPointerSeen'
  );
  assert.equal(
    persisted?.bootstrapCompleted,
    false,
    'bootstrapCompleted NÃO pode virar true enquanto algum domínio falhar'
  );
  svc.dispose();
}

async function testBidirectionalReconciliationAndAuthBlocking() {
  const cloud = new MockCloud();
  const oldIso = '2026-11-01T10:00:00.000Z';
  const curIso = '2026-11-24T12:00:00.000Z';

  // 1) Promotor remoto SEM atualizadoEm (como os 29 documentos de produção) + vínculo ignorado pelo ponteiro
  cloud.setDoc('promotores', 'prom_sem_ts', {
    promotorId: 'prom_sem_ts',
    nome: 'PROMOTOR SEM UPDATEDAT',
    agenciaId: 'ag_1',
    agenciaNome: 'AGENCIA 1',
    filialId: '172',
    filialNome: 'Cascavel',
    setores: ['LOJA'],
    status: 'ATIVO',
    dataCadastro: oldIso,
  });
  cloud.setDoc('vinculos_promotor_industria', 'prom_sem_ts_11111111000111_172', {
    id: 'prom_sem_ts_11111111000111_172',
    vinculoId: 'prom_sem_ts_11111111000111_172',
    promotorId: 'prom_sem_ts',
    promotorNome: 'PROMOTOR SEM UPDATEDAT',
    agenciaNome: 'AGENCIA 1',
    cnpj: '11111111000111',
    industriaId: '11111111000111',
    filialId: '172',
    ativo: true,
    criadoEm: oldIso,
    atualizadoEm: oldIso,
  });
  cloud.setDoc('filiais/172/config', META_DOC_SYNC_COMERCIAL, {
    filialId: '172',
    versaoEsquema: 1,
    ultimaAlteracaoEm: curIso,
    promotoresUpdatedAt: curIso,
    vinculosIndustriaUpdatedAt: curIso,
  });

  // Device A já tem cursores avançados (ponteiro igual) e possui também um promotor/vínculo local que falta na nuvem (não entrou no outbox)
  const devA = createHarness('dev_reconcile_A', cloud, { isGerencia: false, online: true });
  devA.meta.set('comercial_sync_state_v1', {
    bootstrapCompleted: true,
    initialCloudReconciled: true,
    cursors: {
      promotores: curIso,
      agencias: curIso,
      vinculos_promotor_industria: curIso,
      vinculosPromotorAgencia: curIso,
      vinculos_dispositivo: curIso,
      movimentacoes_comerciais: curIso,
    },
    lastPointerSeen: {
      promotores: curIso,
      agencias: curIso,
      vinculos_promotor_industria: curIso,
      vinculosPromotorAgencia: curIso,
      vinculos_dispositivo: curIso,
      movimentacoes_comerciais: curIso,
    },
    tombstonesVinculosIndustria: {},
    ultimaSincronizacaoIso: curIso,
  });

  devA.localState.promotores.push({
    promotorId: 'prom_local_only',
    nome: 'PROMOTOR LOCAL PERDIDO',
    agenciaId: 'ag_1',
    agenciaNome: 'AGENCIA 1',
    filialId: '172',
    filialNome: 'Cascavel',
    setores: ['FRIOS'],
    status: 'ATIVO',
    permissoes: { ...PERMISSOES_PADRAO_PROMOTOR },
    criadoPor: 'Gerencia',
    atualizadoPor: 'Gerencia',
    dataCadastro: curIso,
    atualizadoEm: curIso,
  });
  devA.localState.vinculosIndustria.push({
    id: 'prom_local_only_22222222000122_172',
    promotorId: 'prom_local_only',
    promotorNome: 'PROMOTOR LOCAL PERDIDO',
    agenciaNome: 'AGENCIA 1',
    cnpj: '22222222000122',
    filialId: '172',
    criado_em: curIso,
    atualizadoEm: curIso,
    ativo: true,
  });

  devA.service.setBridge({
    getSnapshot: () => devA.localState,
    applyMergedState: async (p) => {
      if (p.promotores) devA.localState.promotores = p.promotores;
      if (p.agencias) devA.localState.agencias = p.agencias;
      if (p.vinculosIndustria) devA.localState.vinculosIndustria = p.vinculosIndustria;
    },
  });

  // 1a tentativa sem Gerência: reconciliação puxa os dados remotos faltantes (sem atualizadoEm!) e enfileira deltas locais bloqueados
  const resSemGerencia = await devA.service.sincronizarAgora({ reconciliar: true });
  assert.equal(resSemGerencia.sucesso, false, 'Com deltas locais bloqueados sem Gerência, sucesso deve ser false');
  assert.equal(resSemGerencia.aguardandoGerencia, true, 'Deve indicar aguardandoGerencia');
  assert.ok(resSemGerencia.bloqueados > 0, 'Deve informar quantidade de lotes bloqueados aguardando Gerência');
  assert.ok(resSemGerencia.recebidos >= 2, `Deve ter recebido os docs remotos mesmo sem atualizadoEm (recebeu ${resSemGerencia.recebidos})`);
  assert.equal(devA.localState.promotores.some((p) => p.promotorId === 'prom_sem_ts'), true);
  assert.equal(
    devA.localState.vinculosIndustria.some((v) => v.id === 'prom_sem_ts_11111111000111_172'),
    true
  );

  // 2a tentativa com Gerência autenticada: envia promotor local, vínculo local e vínculo promotor x agência independente!
  devA.setGerencia(true);
  const resComGerencia = await devA.service.sincronizarAgora({ reconciliar: true });
  assert.equal(resComGerencia.sucesso, true, `Com Gerência, reconciliação deve concluir com sucesso: ${resComGerencia.mensagem}`);
  assert.ok(resComGerencia.enviados >= 1, 'Deve ter enviado os registros locais faltantes');
  assert.equal(resComGerencia.pendentes, 0);
  assert.equal(resComGerencia.bloqueados, 0);
  assert.ok(
    cloud.getDoc('vinculos_promotor_industria', 'prom_local_only_22222222000122_172'),
    'Vínculo local faltante deve existir agora no Firestore'
  );
  assert.ok(
    cloud.getDoc('vinculosPromotorAgencia', 'pa_prom_local_only_172'),
    'Vínculo promotor x agência independente deve ser gravado no Firestore'
  );

  // 3a reconciliação repetida: zero duplicações e zero escritas extras!
  const promCountBefore = devA.localState.promotores.length;
  const linkCountBefore = devA.localState.vinculosIndustria.length;
  const resIdempotente = await devA.service.sincronizarAgora({ reconciliar: true });
  assert.equal(resIdempotente.sucesso, true);
  assert.equal(resIdempotente.enviados, 0);
  assert.equal(devA.localState.promotores.length, promCountBefore, 'Não pode duplicar promotores');
  assert.equal(devA.localState.vinculosIndustria.length, linkCountBefore, 'Não pode duplicar vínculos');

  devA.service.dispose();
}

async function testQuotaErrorsKeepQueuesPendingNotErro() {
  resetQuotaExceeded();
  const origStorage = (globalThis as any).localStorage;
  const storageMap = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storageMap.get(k) ?? null,
    setItem: (k: string, v: string) => storageMap.set(k, v),
    removeItem: (k: string) => storageMap.delete(k),
  };

  try {
    // Simular catch direto via check de erro de cota em queue já preenchida
    (syncQueueService as any)._queue = [
      {
        operationId: 'op_quota_v1',
        tipoOperacao: 'UPDATE_VENCIMENTO',
        registroId: 'lote_quota_v1',
        payload: { id: 'lote_quota_v1', filialId: '172' },
        dataHora: new Date().toISOString(),
        status: 'PENDENTE',
        tentativas: 0,
      },
    ];
    const origExecV1 = (syncQueueService as any).executeOperation;
    (syncQueueService as any).executeOperation = async () => {
      throw Object.assign(new Error('Quota exceeded'), { code: 'resource-exhausted' });
    };

    try {
      await syncQueueService.processQueue();
      assert.equal(syncQueueService.hasErrors(), false, 'Erro de cota no syncQueueService NÃO pode marcar ERRO');
      assert.equal(syncQueueService.getPendingCount(), 1, 'Operação deve permanecer PENDENTE após erro de cota');
    } finally {
      (syncQueueService as any).executeOperation = origExecV1;
      resetQuotaExceeded();
      (syncQueueService as any)._queue = [];
    }

    (nuvemSyncEngine as any)._queue = [
      {
        opId: 'op_quota_v3',
        tipo: 'UPDATE',
        filialId: '172',
        loteId: 'lote_quota_v3',
        payload: { id: 'lote_quota_v3', filialId: '172' },
        versaoLocal: 1,
        timestampCriacao: new Date().toISOString(),
        status: 'PENDENTE',
        tentativas: 0,
        usuario: 'Op',
        papelUsuario: 'OPERADOR_LOJA',
      },
    ];
    const origExecV3 = (nuvemSyncEngine as any).executarOperacaoComProtecaoConcorrencia;
    (nuvemSyncEngine as any).executarOperacaoComProtecaoConcorrencia = async () => {
      throw Object.assign(new Error('Resource-exhausted: daily quota'), { code: 'resource-exhausted' });
    };

    try {
      const resV3 = await nuvemSyncEngine.processarFila();
      assert.equal(resV3.erros, 0, 'Erro de cota no nuvemSyncEngine NÃO pode incrementar erros');
      assert.equal(nuvemSyncEngine.getContadores().erros, 0);
      assert.equal(nuvemSyncEngine.getContadores().pendentes, 1);
    } finally {
      (nuvemSyncEngine as any).executarOperacaoComProtecaoConcorrencia = origExecV3;
      resetQuotaExceeded();
      (nuvemSyncEngine as any)._queue = [];
    }
  } finally {
    if (origStorage === undefined) delete (globalThis as any).localStorage;
    else (globalThis as any).localStorage = origStorage;
  }
}

async function main() {
  await testBootRaceConditionBarrier();
  await testDeferredOutboxTimestampSkew();
  await testQueueErrorRetryAndClear();
  await testPayloadSanitizationNoNullsOrExtraKeys();
  await testFailedDomainFetchDoesNotAdvanceCursor();
  await testBidirectionalReconciliationAndAuthBlocking();
  await testQuotaErrorsKeepQueuesPendingNotErro();
  console.log('✅ bugfixSyncAndHeader.test.ts: Todos os 7 cenários de regressão, sanitização e reconciliação PASSARAM!');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Falha em bugfixSyncAndHeader.test.ts:', err);
  process.exit(1);
});
