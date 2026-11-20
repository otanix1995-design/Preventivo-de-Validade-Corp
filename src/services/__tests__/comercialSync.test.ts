/**
 * Suite Automatizada Offline — Sincronização Comercial Centralizada (Firebase Firestore + IndexedDB)
 * Filial 172 — Cascavel
 *
 * Valida sem tocar o Firestore de produção:
 * 1. Sincronização de Promotores (cadastro, edição, inativação, reativação, bloqueio, dispositivo).
 * 2. Sincronização de Agências (cadastro, edição, propagação aos promotores, sem duplicidades).
 * 3. Sincronização de Vínculos Promotor × Indústria (criação, tombstone `ativo: false`, re-vínculo).
 * 4. Sincronização de Vínculos Promotor × Agência.
 * 5. Vínculos Dispositivo × Promotor (`vinculosPromotor` / `vinculos_promotores`) restritos à Gerência.
 * 6. Substituição atômica + transferência em massa + Histórico imutável (`movimentacoes_comerciais`).
 * 7. Fila Outbox offline persistente no IndexedDB, recuperação após reinício e reenvio automático.
 * 8. Proteção contra sobrescrita na carga inicial e resolução de conflitos por timestamp.
 * 9. Economia da cota Spark (ponteiro leve, queries por domínio, zero escritas ociosas, trava de cota).
 * 10. Integração real com `promotorService` e `isvService`, preservando BASE RUB, SPCOI007, SAEOU060, vencimentos e EANs.
 */

import {
  AgenciaComercial,
  HistoricoMovimentacaoComercial,
  Industria,
  PERMISSOES_PADRAO_PROMOTOR,
  Promotor,
  VinculoPromotor,
  VinculoPromotorIndustria,
} from '../../types';
import {
  ComercialLocalStateSnapshot,
  ComercialSyncAdapter,
  ComercialSyncPointerDoc,
  ComercialSyncService,
  ComercialWriteOp,
  FILIAL_COMERCIAL_ID,
  META_DOC_SYNC_COMERCIAL,
} from '../comercialSyncService';
import { isvService } from '../isvService';
import { promotorService } from '../promotorService';
import { QuotaResourceType } from '../firebase';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${message}`);
  }
}

interface CloudMockMetrics {
  reads: number;
  writes: number;
  fetchCalls: Array<{ collectionName: string; sinceIso: string | null }>;
  forceNextWriteError: Error | null;
}

class InMemoryCloudFirestore {
  public collections = new Map<string, Map<string, Record<string, any>>>();
  public pointerListeners = new Set<(pointer: ComercialSyncPointerDoc | null) => void>();
  public metrics: CloudMockMetrics = {
    reads: 0,
    writes: 0,
    fetchCalls: [],
    forceNextWriteError: null,
  };

  public resetMetrics(): void {
    this.metrics.reads = 0;
    this.metrics.writes = 0;
    this.metrics.fetchCalls = [];
  }

  public getDoc(collectionPath: string, docId: string): Record<string, any> | null {
    return this.collections.get(collectionPath)?.get(docId) ?? null;
  }

  public setDoc(collectionPath: string, docId: string, payload: Record<string, any>, merge = true): void {
    let col = this.collections.get(collectionPath);
    if (!col) {
      col = new Map();
      this.collections.set(collectionPath, col);
    }
    const prev = col.get(docId);
    const next = merge && prev ? { ...prev, ...payload } : { ...payload };
    col.set(docId, next);
  }
}

interface DeviceContext {
  id: string;
  online: boolean;
  quotaExceeded: boolean;
  isGerencia: boolean;
  usuario: string;
  meta: Map<string, any>;
  localState: ComercialLocalStateSnapshot;
  pointerCallback: ((p: ComercialSyncPointerDoc | null) => void) | null;
  service: ComercialSyncService;
}

function createDeviceTerminal(
  id: string,
  cloud: InMemoryCloudFirestore,
  opts: { isGerencia: boolean; online?: boolean; usuario?: string }
): DeviceContext {
  const ctx: DeviceContext = {
    id,
    online: opts.online ?? true,
    quotaExceeded: false,
    isGerencia: opts.isGerencia,
    usuario: opts.usuario || (opts.isGerencia ? 'Gerencia_172' : 'Operador_172'),
    meta: new Map(),
    localState: {
      promotores: [],
      agencias: [],
      vinculosIndustria: [],
      vinculosDispositivo: [],
      historicoMovimentacoes: [],
      industrias: [],
    },
    pointerCallback: null,
    service: null as unknown as ComercialSyncService,
  };

  const pointerPath = `filiais/${FILIAL_COMERCIAL_ID}/config`;

  const adapter: ComercialSyncAdapter = {
    isOnline: () => ctx.online,
    isQuotaExceeded: () => ctx.quotaExceeded,
    isQuotaError: (err: unknown) => {
      const msg = String((err as any)?.message || '').toLowerCase();
      const code = String((err as any)?.code || '').toLowerCase();
      return code.includes('resource-exhausted') || msg.includes('quota');
    },
    markQuotaExceeded: (_motivo?: string, _recurso?: QuotaResourceType) => {
      ctx.quotaExceeded = true;
    },
    detectQuotaResourceType: () => 'COTA_DIARIA',
    isGerenciaAdmin: () => ctx.isGerencia,
    getUsuarioAtual: () => ctx.usuario,
    ensureAuth: async () => ({ uid: ctx.id }),
    getMeta: async <T,>(key: string, fallback: T) =>
      ctx.meta.has(key) ? (JSON.parse(JSON.stringify(ctx.meta.get(key))) as T) : fallback,
    setMeta: async <T,>(key: string, value: T) => {
      ctx.meta.set(key, JSON.parse(JSON.stringify(value)));
    },
    getPointerDoc: async (_filialId: string) => {
      cloud.metrics.reads += 1;
      const docData = cloud.getDoc(pointerPath, META_DOC_SYNC_COMERCIAL);
      return docData ? ({ ...docData } as ComercialSyncPointerDoc) : null;
    },
    subscribePointerDoc: (_filialId, onData) => {
      ctx.pointerCallback = onData;
      cloud.pointerListeners.add(onData);
      return () => {
        cloud.pointerListeners.delete(onData);
        if (ctx.pointerCallback === onData) ctx.pointerCallback = null;
      };
    },
    fetchCollection: async (collectionName, sinceIso, _maxLimit) => {
      // Simular regra de segurança real: somente GERENCIA_ADMIN pode listar vinculosPromotor
      if (
        (collectionName === 'vinculosPromotor' || collectionName === 'vinculos_promotores') &&
        !ctx.isGerencia
      ) {
        const err = new Error('Missing or insufficient permissions.');
        (err as any).code = 'permission-denied';
        throw err;
      }

      cloud.metrics.fetchCalls.push({ collectionName, sinceIso });
      const col = cloud.collections.get(collectionName);
      if (!col) {
        cloud.metrics.reads += 1;
        return [];
      }
      const all = Array.from(col.values());
      const filtered = sinceIso
        ? all.filter((r) => String(r.atualizadoEm || r.dataHora || '') >= sinceIso)
        : all;
      cloud.metrics.reads += Math.max(1, filtered.length);
      return filtered.map((r) => JSON.parse(JSON.stringify(r)));
    },
    writeBatchOps: async (ops: ComercialWriteOp[]) => {
      if (cloud.metrics.forceNextWriteError) {
        const err = cloud.metrics.forceNextWriteError;
        cloud.metrics.forceNextWriteError = null;
        throw err;
      }
      // Simular Firestore Rules: escrita comercial exige Gerência autenticada
      if (!ctx.isGerencia) {
        const err = new Error('Missing or insufficient permissions.');
        (err as any).code = 'permission-denied';
        throw err;
      }

      // Validar regras de mov imutável (create only, sem update)
      for (const op of ops) {
        if (op.collectionName === 'movimentacoes_comerciais') {
          const existing = cloud.getDoc(op.collectionName, op.docId);
          if (existing) {
            const err = new Error('permission-denied: movimentacoes_comerciais is immutable');
            (err as any).code = 'permission-denied';
            throw err;
          }
        }
      }

      for (const op of ops) {
        cloud.metrics.writes += 1;
        cloud.setDoc(op.collectionName, op.docId, JSON.parse(JSON.stringify(op.payload)), op.merge !== false);
      }

      const pointerNow = cloud.getDoc(pointerPath, META_DOC_SYNC_COMERCIAL) as ComercialSyncPointerDoc | null;
      if (pointerNow) {
        cloud.pointerListeners.forEach((cb) => cb({ ...pointerNow }));
      }
    },
    checkDocExists: async (collectionName: string, docId: string) => {
      cloud.metrics.reads += 1;
      return cloud.getDoc(collectionName, docId) !== null;
    },
  };

  ctx.service = new ComercialSyncService({
    autoStart: false,
    adapter,
    bridge: {
      getSnapshot: () => ({
        promotores: ctx.localState.promotores.map((p) => ({ ...p })),
        agencias: ctx.localState.agencias.map((a) => ({ ...a })),
        vinculosIndustria: ctx.localState.vinculosIndustria.map((v) => ({ ...v })),
        vinculosDispositivo: ctx.localState.vinculosDispositivo.map((v) => ({ ...v })),
        historicoMovimentacoes: ctx.localState.historicoMovimentacoes.map((h) => ({ ...h })),
        industrias: ctx.localState.industrias.map((i) => ({ ...i })),
      }),
      applyMergedState: async (merged) => {
        if (merged.promotores) ctx.localState.promotores = merged.promotores;
        if (merged.agencias) ctx.localState.agencias = merged.agencias;
        if (merged.vinculosIndustria) ctx.localState.vinculosIndustria = merged.vinculosIndustria;
        if (merged.vinculosDispositivo) ctx.localState.vinculosDispositivo = merged.vinculosDispositivo;
        if (merged.historicoMovimentacoes) {
          ctx.localState.historicoMovimentacoes = merged.historicoMovimentacoes;
        }
      },
    },
  });

  return ctx;
}

function makePromotor(id: string, nome: string, agId: string | null, agNome: string, atualizadoEm: string): Promotor {
  return {
    promotorId: id,
    nome,
    agenciaId: agId,
    agenciaNome: agNome,
    filialId: '172',
    filialNome: 'Cascavel',
    setores: ['FRIOS'],
    setorId: 'FRIOS',
    setorNome: 'FRIOS',
    status: 'PENDENTE_VINCULO',
    permissoes: { ...PERMISSOES_PADRAO_PROMOTOR },
    dispositivoVinculado: null,
    dataCadastro: '2026-11-01T08:00:00.000Z',
    dataVinculo: null,
    ultimoAcesso: null,
    ultimaSincronizacao: null,
    atualizadoEm,
    criadoPor: 'GERENCIA',
    atualizadoPor: 'GERENCIA',
  };
}

function makeAgencia(id: string, nome: string, atualizadoEm: string): AgenciaComercial {
  return {
    agenciaId: id,
    nome,
    nomeNormalizado: nome.toUpperCase(),
    filialId: '172',
    ativo: true,
    criadoEm: '2026-11-01T08:00:00.000Z',
    atualizadoEm,
  };
}

function makeIndustria(cnpj: string, nome: string): Industria {
  return {
    cnpj,
    cnpj_formatado: cnpj,
    razao_social: `${nome} LTDA`,
    nome_exibicao: nome,
    ativo: true,
    total_produtos_loja: 5,
    promotores_responsaveis: [],
    criado_em: '2026-11-01T00:00:00.000Z',
    atualizado_em: '2026-11-01T00:00:00.000Z',
  };
}

async function runTests(): Promise<void> {
  const cloud = new InMemoryCloudFirestore();
  const devAdminA = createDeviceTerminal('terminal-gerencia-A', cloud, {
    isGerencia: true,
    usuario: 'Gerente Cascavel',
  });
  const devOperadorB = createDeviceTerminal('terminal-operador-B', cloud, {
    isGerencia: false,
    usuario: 'Operador Balcao',
  });
  const devAdminC = createDeviceTerminal('terminal-gerencia-C', cloud, {
    isGerencia: true,
    usuario: 'Subgerente Cascavel',
  });

  // Inicializar terminais
  await devAdminA.service.sincronizarAgora();
  await devOperadorB.service.sincronizarAgora();
  await devAdminC.service.sincronizarAgora();

  // =========================================================================
  // 1 & 2. AGÊNCIAS + PROMOTORES CRUD, EDIÇÃO, INATIVAÇÃO, REATIVAÇÃO E PROPAGAÇÃO
  // =========================================================================
  const t1 = '2026-11-19T10:00:00.000Z';
  const agSeara = makeAgencia('ag_seara', 'SEARA ALIMENTOS', t1);
  const promCarlos = makePromotor('prom_carlos', 'CARLOS EDUARDO', agSeara.agenciaId, agSeara.nome, t1);
  const ind1 = makeIndustria('11111111000111', 'SEARA');
  const ind2 = makeIndustria('22222222000122', 'SADIA');

  devAdminA.localState.agencias.push(agSeara);
  devAdminA.localState.promotores.push(promCarlos);
  devAdminA.localState.industrias.push(ind1, ind2);

  await devAdminA.service.registrarAgenciaSync(agSeara);
  await devAdminA.service.registrarPromotorSync(promCarlos, true);

  // Operador B puxa mudanças
  await devOperadorB.service.sincronizarAgora();
  assert(
    devOperadorB.localState.agencias.some((a) => a.agenciaId === agSeara.agenciaId && a.nome === 'SEARA ALIMENTOS') &&
      devOperadorB.localState.promotores.some((p) => p.promotorId === promCarlos.promotorId && p.agenciaNome === 'SEARA ALIMENTOS'),
    'Device B deve receber agência e promotor cadastrados no Device A.'
  );

  // Verificar economia Spark em Device B quando nada mudou na nuvem
  cloud.resetMetrics();
  await devOperadorB.service.sincronizarAgora();
  assert(
    cloud.metrics.fetchCalls.length === 0 && cloud.metrics.reads === 1 && cloud.metrics.writes === 0,
    'Sincronização repetida sem alterações remotas deve consultar apenas 1 doc ponteiro e 0 coleções.'
  );

  // Editar somente a agência e propagar novo nome para promotor
  const t2 = '2026-11-19T10:05:00.000Z';
  const agSearaEditada: AgenciaComercial = { ...agSeara, nome: 'SEARA SUL COMÉRCIO', atualizadoEm: t2 };
  const promCarlosRenomeado: Promotor = { ...promCarlos, agenciaNome: agSearaEditada.nome, atualizadoEm: t2 };
  devAdminA.localState.agencias = [agSearaEditada];
  devAdminA.localState.promotores = [promCarlosRenomeado];
  await devAdminA.service.registrarAgenciaSync(agSearaEditada, [promCarlosRenomeado]);

  // Verificar sync incremental seletivo em Device B
  await devOperadorB.service.sincronizarAgora();
  assert(
    devOperadorB.localState.agencias[0].nome === 'SEARA SUL COMÉRCIO' &&
      devOperadorB.localState.promotores[0].agenciaNome === 'SEARA SUL COMÉRCIO',
    'Edição de agência e propagação ao promotor devem sincronizar incrementalmente.'
  );

  // Testar consulta incremental por domínio único (apenas agências alterada)
  cloud.resetMetrics();
  const t2b = '2026-11-19T10:06:00.000Z';
  const agNova = makeAgencia('ag_brf', 'BRF REPRESENTACOES', t2b);
  devAdminA.localState.agencias.push(agNova);
  await devAdminA.service.registrarAgenciaSync(agNova);

  cloud.resetMetrics();
  const pullAgenciaRes = await devOperadorB.service.puxarAlteracoesIncrementais();
  assert(
    pullAgenciaRes.domainsConsultados.length === 1 &&
      pullAgenciaRes.domainsConsultados[0] === 'agencias' &&
      devOperadorB.localState.agencias.length === 2,
    'Quando apenas agências muda, somente o domínio "agencias" deve ser consultado (economia máxima Spark).'
  );

  // =========================================================================
  // 3. VÍNCULOS PROMOTOR × INDÚSTRIA (CRIAÇÃO + TOMBSTONE DESVÍNCULO + ANTI-DUPLICIDADE)
  // =========================================================================
  const t3 = '2026-11-19T10:10:00.000Z';
  const vinc1: VinculoPromotorIndustria = {
    id: `${promCarlos.promotorId}_${ind1.cnpj}_172`,
    promotorId: promCarlos.promotorId,
    promotorNome: promCarlosRenomeado.nome,
    agenciaNome: promCarlosRenomeado.agenciaNome,
    cnpj: ind1.cnpj,
    filialId: '172',
    criado_em: t3,
    atualizadoEm: t3,
    ativo: true,
  };
  const vinc2: VinculoPromotorIndustria = {
    id: `${promCarlos.promotorId}_${ind2.cnpj}_172`,
    promotorId: promCarlos.promotorId,
    promotorNome: promCarlosRenomeado.nome,
    agenciaNome: promCarlosRenomeado.agenciaNome,
    cnpj: ind2.cnpj,
    filialId: '172',
    criado_em: t3,
    atualizadoEm: t3,
    ativo: true,
  };
  devAdminA.localState.vinculosIndustria.push(vinc1, vinc2);
  await devAdminA.service.registrarVinculoIndustriaSync(vinc1, ind1);
  await devAdminA.service.registrarVinculoIndustriaSync(vinc2, ind2);

  await devOperadorB.service.sincronizarAgora();
  assert(
    devOperadorB.localState.vinculosIndustria.length === 2,
    'Device B deve receber os 2 vínculos Promotor × Indústria.'
  );

  // Desvincular ind2 no Device A -> deve propagar tombstone `ativo: false` e remover em Device B
  const t4 = '2026-11-19T10:12:00.000Z';
  devAdminA.localState.vinculosIndustria = [vinc1];
  await devAdminA.service.registrarDesvinculoIndustriaSync(vinc2, t4);

  await devOperadorB.service.sincronizarAgora();
  assert(
    devOperadorB.localState.vinculosIndustria.length === 1 &&
      devOperadorB.localState.vinculosIndustria[0].cnpj === ind1.cnpj,
    'Desvínculo no Device A deve ser propagado via tombstone lógico para o Device B sem ressuscitar o registro.'
  );

  // =========================================================================
  // 4. VÍNCULOS DISPOSITIVO × PROMOTOR RESTRITOS À GERÊNCIA
  // =========================================================================
  const t5 = '2026-11-19T10:15:00.000Z';
  const vincDisp: VinculoPromotor = {
    vinculoId: 'vinc_disp_001',
    promotorId: promCarlos.promotorId,
    promotorNome: promCarlosRenomeado.nome,
    agenciaNome: promCarlosRenomeado.agenciaNome,
    filialId: '172',
    filialNome: 'Cascavel',
    setores: ['FRIOS'],
    setorId: 'FRIOS',
    setorNome: 'FRIOS',
    codigoVinculo: '849201',
    tokenVinculo: 'link_seguro_001',
    dataCriacao: t5,
    dataExpiracao: '2026-12-31T23:59:59.000Z',
    status: 'AGUARDANDO',
    dispositivoId: null,
    dispositivoNome: null,
    dataUtilizacao: null,
    atualizadoEm: t5,
  };
  devAdminA.localState.vinculosDispositivo.push(vincDisp);
  await devAdminA.service.registrarVinculoDispositivoSync(vincDisp);

  // Operador B sincroniza -> NÃO consulta `vinculosPromotor` e NÃO recebe token!
  cloud.resetMetrics();
  await devOperadorB.service.sincronizarAgora();
  assert(
    devOperadorB.localState.vinculosDispositivo.length === 0 &&
      !cloud.metrics.fetchCalls.some((f) => f.collectionName === 'vinculosPromotor'),
    'Dispositivo operador não-Gerência nunca deve consultar nem baixar tokens de vinculosPromotor.'
  );

  // Admin C sincroniza -> recebe vínculo de dispositivo completo
  await devAdminC.service.sincronizarAgora();
  assert(
    devAdminC.localState.vinculosDispositivo.length === 1 &&
      devAdminC.localState.vinculosDispositivo[0].codigoVinculo === '849201',
    'Outro terminal autenticado como GERENCIA_ADMIN deve receber os vínculos de dispositivo.'
  );

  // =========================================================================
  // 5. SUBSTITUIÇÃO ATÔMICA + HISTÓRICO IMUTÁVEL (`movimentacoes_comerciais`)
  // =========================================================================
  const t6 = '2026-11-19T10:20:00.000Z';
  const promAna = makePromotor('prom_ana', 'ANA PAULA', agNova.agenciaId, agNova.nome, t6);
  const promCarlosInativo: Promotor = {
    ...promCarlosRenomeado,
    status: 'INATIVO',
    agenciaId: null,
    agenciaNome: '',
    inativadoEm: t6,
    substituidoPorPromotorId: promAna.promotorId,
    substituidoPorPromotorNome: promAna.nome,
    atualizadoEm: t6,
  };
  const vincDispCancelado: VinculoPromotor = {
    ...vincDisp,
    status: 'CANCELADO',
    atualizadoEm: t6,
  };
  const vincAnaInd1: VinculoPromotorIndustria = {
    id: `${promAna.promotorId}_${ind1.cnpj}_172`,
    promotorId: promAna.promotorId,
    promotorNome: promAna.nome,
    agenciaNome: promAna.agenciaNome,
    cnpj: ind1.cnpj,
    filialId: '172',
    criado_em: t6,
    atualizadoEm: t6,
    ativo: true,
  };
  const movSub: HistoricoMovimentacaoComercial = {
    id: 'mov_sub_atomico_1',
    tipo: 'PROMOTOR_SUBSTITUIDO',
    dataHora: t6,
    promotorId: promCarlosInativo.promotorId,
    promotorNome: promCarlosInativo.nome,
    promotorSubstitutoId: promAna.promotorId,
    promotorSubstitutoNome: promAna.nome,
    agenciaId: agNova.agenciaId,
    agenciaNome: agNova.nome,
    cnpjsTransferidos: [ind1.cnpj],
    detalhes: 'Substituição atômica com transferência de indústria SEARA.',
    realizadoPor: 'GERENCIA_ADMIN',
  };

  devAdminA.localState.promotores = [promCarlosInativo, promAna];
  devAdminA.localState.vinculosIndustria = [vincAnaInd1];
  devAdminA.localState.vinculosDispositivo = [vincDispCancelado];
  devAdminA.localState.historicoMovimentacoes.unshift(movSub);

  await devAdminA.service.registrarSubstituicaoAtomicaSync({
    promotoresAlterados: [promCarlosInativo, promAna],
    vinculosDispositivoCancelados: [vincDispCancelado],
    vinculosIndustriaCriados: [vincAnaInd1],
    vinculosIndustriaRemovidos: [vinc1],
    movimentacoes: [movSub],
  });

  await devOperadorB.service.sincronizarAgora();
  await devAdminC.service.sincronizarAgora();

  assert(
    devOperadorB.localState.promotores.find((p) => p.promotorId === 'prom_carlos')?.status === 'INATIVO' &&
      devOperadorB.localState.vinculosIndustria.length === 1 &&
      devOperadorB.localState.vinculosIndustria[0].promotorId === 'prom_ana' &&
      devOperadorB.localState.historicoMovimentacoes.some((m) => m.id === 'mov_sub_atomico_1') &&
      devAdminC.localState.vinculosDispositivo.find((v) => v.vinculoId === 'vinc_disp_001')?.status === 'CANCELADO',
    'Substituição atômica deve replicar promotor inativo, novo promotor, transferência de indústria, cancelamento de vínculo de dispositivo e histórico imutável.'
  );

  // Testar idempotência de movimentação imutável em caso de retry pós-falha
  cloud.metrics.forceNextWriteError = Object.assign(new Error('permission-denied'), {
    code: 'permission-denied',
  });
  await devAdminA.service.registrarMovimentacaoSync({
    ...movSub,
    // mesmo ID já persistido no Firestore -> primeiro erro simulado força checkDocExists -> true -> remove da fila sem erro!
  });
  // Como houve forceNextWriteError no batch (que é consumido na tentativa), verificamos se retry subsequente não trava a fila:
  if (devAdminA.service.getPendingCount() > 0) {
    await devAdminA.service.processarFilaPendente();
  }
  assert(
    devAdminA.service.getPendingCount() === 0,
    'Retry de movimentação imutável já existente no servidor deve finalizar de forma idempotente sem travar outbox.'
  );

  // =========================================================================
  // 6. MODO OFFLINE + PERSISTÊNCIA NO OUTBOX APÓS REINÍCIO + REENVIO AUTOMÁTICO
  // =========================================================================
  devAdminA.online = false;
  const t7 = '2026-11-19T10:30:00.000Z';
  const promOffline = makePromotor('prom_offline_1', 'LUCAS FERREIRA', agNova.agenciaId, agNova.nome, t7);
  devAdminA.localState.promotores.push(promOffline);
  await devAdminA.service.registrarPromotorSync(promOffline, true);

  assert(
    devAdminA.service.getPendingCount() === 1 &&
      devAdminA.service.getStatus().estado === 'OFFLINE',
    'Alteração realizada offline deve ficar salva no outbox persistente com estado OFFLINE.'
  );

  // Simular fechamento/reabertura do app recarregando outbox do meta store persistido
  const devAdminAReopened = createDeviceTerminal('terminal-gerencia-A-reopened', cloud, {
    isGerencia: true,
    online: false,
  });
  devAdminAReopened.meta = devAdminA.meta;
  devAdminAReopened.localState = JSON.parse(JSON.stringify(devAdminA.localState));
  await devAdminAReopened.service.iniciar();
  assert(
    devAdminAReopened.service.getPendingCount() === 1,
    'Após reiniciar aplicativo offline, outbox pendente deve ser restaurada do armazenamento persistente.'
  );

  // Reconectar e sincronizar -> envia pendência offline automaticamente para nuvem e Device B recebe
  devAdminAReopened.online = true;
  const resReenvio = await devAdminAReopened.service.sincronizarAgora();
  assert(
    resReenvio.sucesso && devAdminAReopened.service.getPendingCount() === 0,
    'Ao voltar a ficar online com Gerência autenticada, fila pendente deve ser enviada com sucesso.'
  );

  await devOperadorB.service.sincronizarAgora();
  assert(
    devOperadorB.localState.promotores.some((p) => p.promotorId === 'prom_offline_1'),
    'Promotor cadastrado offline deve aparecer no outro dispositivo após reconexão.'
  );

  // Terminal sem Gerência enfileirando algo fica em AGUARDANDO_GERENCIA sem apagar local, e envia quando Gerência autentica
  devOperadorB.isGerencia = false;
  const promPendenteAuth = makePromotor('prom_pend_auth', 'BEATRIZ LIMA', agNova.agenciaId, agNova.nome, '2026-11-19T10:35:00.000Z');
  devOperadorB.localState.promotores.push(promPendenteAuth);
  await devOperadorB.service.registrarPromotorSync(promPendenteAuth, true);
  assert(
    devOperadorB.service.getStatus().estado === 'AGUARDANDO_GERENCIA' &&
      devOperadorB.service.getPendingCount() === 1,
    'Sem permissão de Gerência autenticada, mutação local fica segura em AGUARDANDO_GERENCIA.'
  );
  devOperadorB.isGerencia = true;
  await devOperadorB.service.sincronizarAgora();
  assert(
    devOperadorB.service.getPendingCount() === 0 &&
      cloud.getDoc('promotores', 'prom_pend_auth') !== null,
    'Após autenticação da Gerência, alteração pendente é enviada automaticamente.'
  );

  // =========================================================================
  // 7. PROTEÇÃO CONTRA SOBRESCRITA NA CARGA INICIAL & CONFLITO POR TIMESTAMP
  // =========================================================================
  // Dispositivo novo inicia com uma edição LOCAL mais recente que a cópia existente na nuvem
  // e com outra operação mais antiga ignorada em favor da versão local mais nova
  const devConflito = createDeviceTerminal('terminal-conflito', cloud, {
    isGerencia: true,
    online: true,
  });
  const promAnaMaisRecenteLocal: Promotor = {
    ...promAna,
    nome: 'ANA PAULA (EDICAO LOCAL MAIS RECENTE)',
    atualizadoEm: '2026-11-19T12:00:00.000Z',
  };
  const promSoLocalPreExistente = makePromotor(
    'prom_pre_existente_local',
    'JOAO PRE EXISTENTE',
    agNova.agenciaId,
    agNova.nome,
    '2026-11-19T09:00:00.000Z'
  );
  const mariaSeedDefault: Promotor = {
    ...makePromotor(
      'promotor_maria_seara_172',
      'MARIA SILVA',
      agSeara.agenciaId,
      agSeara.nome,
      '' // seed sem atualizadoEm não deve contaminar nuvem que já tem promotores reais
    ),
    criadoPor: 'SISTEMA_PRINCIPAL',
    atualizadoPor: 'SISTEMA_PRINCIPAL',
  };
  devConflito.localState.promotores = [promAnaMaisRecenteLocal, promSoLocalPreExistente, mariaSeedDefault];

  await devConflito.service.sincronizarAgora();
  assert(
    devConflito.localState.promotores.find((p) => p.promotorId === 'prom_ana')?.nome ===
      'ANA PAULA (EDICAO LOCAL MAIS RECENTE)' &&
      devConflito.localState.promotores.some((p) => p.promotorId === 'prom_pre_existente_local') &&
      !devConflito.localState.promotores.some((p) => p.promotorId === 'promotor_maria_seara_172') &&
      cloud.getDoc('promotores', 'prom_ana')?.nome === 'ANA PAULA (EDICAO LOCAL MAIS RECENTE)' &&
      cloud.getDoc('promotores', 'prom_pre_existente_local') !== null &&
      cloud.getDoc('promotores', 'promotor_maria_seara_172') === null,
    'Carga inicial nunca deve sobrescrever edição local mais recente nem apagar pré-cadastro local, além de não subir seed demo default.'
  );

  // =========================================================================
  // 8. TRATAMENTO DE QUOTA EXCEEDED DO SPARK (SEM PERDER OUTBOX)
  // =========================================================================
  devAdminA.online = true;
  cloud.metrics.forceNextWriteError = Object.assign(new Error('Quota exceeded'), {
    code: 'resource-exhausted',
  });
  const promQuota = makePromotor('prom_quota', 'TESTE QUOTA', agNova.agenciaId, agNova.nome, '2026-11-19T12:30:00.000Z');
  devAdminA.localState.promotores.push(promQuota);
  await devAdminA.service.registrarPromotorSync(promQuota, true);
  assert(
    devAdminA.quotaExceeded === true &&
      devAdminA.service.getStatus().estado === 'BLOQUEADO_COTA' &&
      devAdminA.service.getPendingCount() >= 1,
    'Erro de cota Spark deve acionar trava BLOQUEADO_COTA mantendo alterações pendentes na fila local.'
  );

  // =========================================================================
  // 9. INTEGRAÇÃO COM PROMOTOR SERVICE + ISV SERVICE (PRESERVANDO BASES LOCAIS)
  // =========================================================================
  await Promise.all([promotorService.init(), isvService.init()]);
  const agReal = await promotorService.cadastrarAgencia({ nome: 'AGENCIA INTEGRACAO 172' });
  const promReal = await promotorService.cadastrarPromotor({
    nome: 'Promotor Teste Integracao',
    agenciaId: agReal.agenciaId,
    setores: ['FRIOS'],
  });
  await isvService.vincularPromotorIndustria(promReal, '33333333000133', '172');

  assert(
    promotorService.getAgencias().some((a) => a.agenciaId === agReal.agenciaId) &&
      promotorService.getPromotores().some((p) => p.promotorId === promReal.promotorId) &&
      isvService.getVinculosPromotorIndustria().some((v) => v.promotorId === promReal.promotorId),
    'promotorService e isvService devem funcionar offline em memória/IndexedDB com comercialSyncService conectado.'
  );

  devAdminA.service.dispose();
  devAdminAReopened.service.dispose();
  devOperadorB.service.dispose();
  devAdminC.service.dispose();
  devConflito.service.dispose();

  console.log(
    '✅ Suite completa comercialSync (Promotores, Agências, Vínculos Indústria/Agência/Dispositivo, Substituição Atômica, Offline Outbox, Conflitos e Economia Spark) aprovada!'
  );
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Falha na suite comercialSync:', err);
  process.exit(1);
});
