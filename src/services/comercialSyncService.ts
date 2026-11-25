/**
 * SINCRONIZAÇÃO COMERCIAL CENTRALIZADA — FILIAL 172 (CASCAVEL)
 *
 * Sincroniza pelo Firebase Firestore (Spark gratuito) com persistência offline no IndexedDB:
 * - Promotores (cadastros, edições, inativações, reativações, bloqueios, dispositivos)
 * - Agências comerciais (cadastros e edições com deduplicação normalizada)
 * - Vínculos Promotor × Indústria (incluindo exclusões via tombstone lógico `ativo: false`)
 * - Vínculos Promotor × Agência
 * - Vínculos Dispositivo × Promotor (`vinculosPromotor` / `vinculos_promotores`, restritos à Gerência)
 * - Substituições e transferências em massa atômicas
 * - Histórico imutável de movimentações comerciais (`movimentacoes_comerciais`)
 *
 * Estratégia de economia Spark & consistência:
 * 1. Ponteiro leve `/filiais/172/config/sync_comercial_meta` (1 doc): dispositivos só consultam
 *    coleções cujo cursor remoto avançou em relação ao cursor local no IndexedDB.
 * 2. Consultas incrementais por `where('atualizadoEm', '>=', cursorSeguranca)` usando índice
 *    automático de campo único (sem necessidade de índices compostos no Firebase Console).
 * 3. Fila outbox persistente no IndexedDB: gravações feitas offline (ou antes do login Gerência)
 *    ficam protegidas contra sobrescrita e são enviadas automaticamente ao reconectar/autenticar.
 * 4. Resolução determinística de conflitos por timestamp: carga inicial e snapshots antigos
 *    NUNCA sobrescrevem edições locais mais recentes nem operações pendentes na fila.
 *
 * NÃO altera SPCOI007, BASE RUB, SAEOU060, Vencimentos ou Vínculos EAN.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  QueryDocumentSnapshot,
  startAfter,
  Unsubscribe,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AgenciaComercial,
  HistoricoMovimentacaoComercial,
  Industria,
  Promotor,
  VinculoPromotor,
  VinculoPromotorAgencia,
  VinculoPromotorIndustria,
} from '../types';
import {
  gerarAgenciaId,
  isAgenciaSemVinculoNome,
  normalizarChaveAgencia,
} from './agenciaNormalizer';
import { authRoleService } from './authRoleService';
import { dbGetMeta, dbSetMeta, STORES } from './db';
import {
  db,
  detectQuotaResourceType,
  ensureAuth,
  handleFirestoreError,
  isFirestoreQuotaExceeded,
  isQuotaError,
  logFirestoreRead,
  markQuotaExceeded,
  OperationType,
  QuotaResourceType,
  subscribeQuotaStatus,
} from './firebase';
import { formatarCnpj, normalizarCnpj } from './spcoi007Parser';

export const FILIAL_COMERCIAL_ID = '172';
export const META_DOC_SYNC_COMERCIAL = 'sync_comercial_meta';
const META_KEY_OUTBOX = 'comercial_sync_outbox_v1';
const META_KEY_SYNC_STATE = 'comercial_sync_state_v1';

const DEFAULT_FETCH_LIMIT = 300;
const CLOCK_SKEW_OVERLAP_MS = 120_000; // 2 min de tolerância para diferença de relógio entre terminais

export type ComercialSyncDomain =
  | 'promotores'
  | 'agencias'
  | 'vinculos_promotor_industria'
  | 'vinculosPromotorAgencia'
  | 'vinculos_dispositivo'
  | 'movimentacoes_comerciais';

export type ComercialEstadoSync =
  | 'SINCRONIZADO'
  | 'SINCRONIZANDO'
  | 'PENDENTE_ENVIO'
  | 'AGUARDANDO_GERENCIA'
  | 'OFFLINE'
  | 'BLOQUEADO_COTA'
  | 'ERRO';

export interface ComercialWriteOp {
  collectionName: string;
  docId: string;
  payload: Record<string, any>;
  merge?: boolean;
  immutableCreate?: boolean;
}

export interface ComercialOutboxItem {
  opId: string;
  domain: ComercialSyncDomain | 'batch_substituicao';
  criadoEmIso: string;
  entityKeys: string[]; // ex.: 'promotores:prom_1'
  pointerDomains: ComercialSyncDomain[];
  operations: ComercialWriteOp[];
  tentativas: number;
  ultimoErro?: string;
  queuedWhileDeferred?: boolean;
}

export interface ComercialSyncPointerDoc {
  filialId: string;
  versaoEsquema: number;
  ultimaAlteracaoEm: string;
  promotoresUpdatedAt?: string;
  agenciasUpdatedAt?: string;
  vinculosIndustriaUpdatedAt?: string;
  vinculosAgenciaUpdatedAt?: string;
  vinculosDispositivoUpdatedAt?: string;
  movimentacoesUpdatedAt?: string;
  atualizadoPor?: string;
}

export interface ComercialSyncPersistedState {
  bootstrapCompleted: boolean;
  initialCloudReconciled: boolean;
  needsReconciliation?: boolean;
  cursors: Record<ComercialSyncDomain, string | null>;
  lastPointerSeen: Partial<Record<ComercialSyncDomain, string>>;
  tombstonesVinculosIndustria: Record<string, string>; // vinculoId -> atualizadoEmIso
  ultimaSincronizacaoIso: string | null;
}

export interface SincronizarComercialResult {
  sucesso: boolean;
  enviados: number;
  recebidos: number;
  pendentes: number;
  bloqueados: number;
  erros: number;
  erroDetalhe?: string;
  bloqueadoMotivo?: string;
  aguardandoGerencia?: boolean;
  mensagem: string;
}

export interface ComercialSyncStatus {
  estado: ComercialEstadoSync;
  emAndamento: boolean;
  online: boolean;
  isGerenciaAutenticada: boolean;
  pendentesCount: number;
  ultimaSincronizacaoIso: string | null;
  ultimoErro?: string;
  ultimaAlteracaoRemotaIso?: string | null;
}

export interface ComercialRemoteDeltaPayload {
  promotores: Promotor[];
  agencias: AgenciaComercial[];
  vinculosIndustriaAtivos: VinculoPromotorIndustria[];
  vinculosIndustriaRemovidosIds: string[];
  vinculosAgencia: VinculoPromotorAgencia[];
  vinculosDispositivo: VinculoPromotor[];
  movimentacoes: HistoricoMovimentacaoComercial[];
}

export interface ComercialLocalStateSnapshot {
  promotores: Promotor[];
  agencias: AgenciaComercial[];
  vinculosIndustria: VinculoPromotorIndustria[];
  vinculosDispositivo: VinculoPromotor[];
  historicoMovimentacoes: HistoricoMovimentacaoComercial[];
  industrias: Industria[];
}

export interface ComercialPromotorHandlers {
  ensureReady?: () => Promise<void>;
  getPromotores: () => Promotor[];
  getAgencias: () => AgenciaComercial[];
  getVinculosDispositivo: () => VinculoPromotor[];
  getHistoricoMovimentacoes: () => HistoricoMovimentacaoComercial[];
  applyRemoteChanges: (params: {
    promotores?: Promotor[];
    agencias?: AgenciaComercial[];
    vinculosDispositivo?: VinculoPromotor[];
    historicoMovimentacoes?: HistoricoMovimentacaoComercial[];
  }) => Promise<void>;
}

export interface ComercialIsvHandlers {
  ensureReady?: () => Promise<void>;
  getVinculosIndustria: () => VinculoPromotorIndustria[];
  getIndustrias: () => Industria[];
  applyRemoteChanges: (params: {
    vinculosIndustria?: VinculoPromotorIndustria[];
  }) => Promise<void>;
}

export interface ComercialStateBridge {
  ensureReady?: () => Promise<void>;
  getSnapshot: () => ComercialLocalStateSnapshot;
  applyMergedState: (params: {
    promotores?: Promotor[];
    agencias?: AgenciaComercial[];
    vinculosIndustria?: VinculoPromotorIndustria[];
    vinculosDispositivo?: VinculoPromotor[];
    historicoMovimentacoes?: HistoricoMovimentacaoComercial[];
  }) => Promise<void>;
}

export interface ComercialSyncAdapter {
  isOnline: () => boolean;
  isQuotaExceeded: () => boolean;
  isQuotaError: (err: unknown) => boolean;
  markQuotaExceeded: (motivo?: string, recurso?: QuotaResourceType) => void;
  detectQuotaResourceType: (err: unknown) => QuotaResourceType;
  isGerenciaAdmin: () => boolean;
  getUsuarioAtual: () => string;
  ensureAuth: () => Promise<unknown>;
  getMeta: <T>(key: string, fallback: T) => Promise<T>;
  setMeta: <T>(key: string, value: T) => Promise<void>;
  getPointerDoc: (filialId: string) => Promise<ComercialSyncPointerDoc | null>;
  subscribePointerDoc: (
    filialId: string,
    onData: (pointer: ComercialSyncPointerDoc | null) => void,
    onError: (err: unknown) => void
  ) => Unsubscribe | null;
  fetchCollection: (
    collectionName: string,
    sinceIso: string | null,
    maxLimit: number
  ) => Promise<Array<Record<string, any>>>;
  writeBatchOps: (ops: ComercialWriteOp[]) => Promise<void>;
  checkDocExists: (collectionName: string, docId: string) => Promise<boolean>;
}

const DEFAULT_PERSISTED_STATE: ComercialSyncPersistedState = {
  bootstrapCompleted: false,
  initialCloudReconciled: false,
  needsReconciliation: false,
  cursors: {
    promotores: null,
    agencias: null,
    vinculos_promotor_industria: null,
    vinculosPromotorAgencia: null,
    vinculos_dispositivo: null,
    movimentacoes_comerciais: null,
  },
  lastPointerSeen: {},
  tombstonesVinculosIndustria: {},
  ultimaSincronizacaoIso: null,
};

function cloneDefaultState(): ComercialSyncPersistedState {
  return {
    bootstrapCompleted: false,
    initialCloudReconciled: false,
    needsReconciliation: false,
    cursors: { ...DEFAULT_PERSISTED_STATE.cursors },
    lastPointerSeen: {},
    tombstonesVinculosIndustria: {},
    ultimaSincronizacaoIso: null,
  };
}

export function extractTimestampMs(record: any): number {
  if (!record || typeof record !== 'object') return 0;
  const candidates = [
    record.atualizadoEm,
    record.atualizado_em,
    record.ultimaSincronizacao,
    record.dataUtilizacao,
    record.dataHora,
    record.reativadoEm,
    record.inativadoEm,
    record.dataVinculo,
    record.criadoEm,
    record.criado_em,
    record.dataCadastro,
    record.dataCriacao,
  ];
  let best = 0;
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      const ms = Date.parse(c);
      if (!Number.isNaN(ms) && ms > best) {
        best = ms;
      }
    }
  }
  return best;
}

function getLatestIso(a?: string | null, b?: string | null): string {
  const msA = a ? Date.parse(a) : 0;
  const msB = b ? Date.parse(b) : 0;
  if (!Number.isNaN(msA) && !Number.isNaN(msB)) {
    return msA >= msB ? (a || b || '') : (b || a || '');
  }
  return (a || '') >= (b || '') ? (a || '') : (b || '');
}

function subtractSkewIso(cursorIso: string | null): string | null {
  if (!cursorIso) return null;
  const ms = Date.parse(cursorIso);
  if (Number.isNaN(ms)) return cursorIso;
  return new Date(Math.max(0, ms - CLOCK_SKEW_OVERLAP_MS)).toISOString();
}

function isPermissionDeniedError(err: unknown): boolean {
  const code = String((err as any)?.code || '').toLowerCase();
  const msg = String((err as any)?.message || '').toLowerCase();
  return (
    code.includes('permission') ||
    msg.includes('permission-denied') ||
    msg.includes('missing or insufficient permissions')
  );
}

function reportPermissionDiagnostic(
  err: unknown,
  opType: OperationType,
  path: string | null
): void {
  if (!isPermissionDeniedError(err)) return;
  try {
    handleFirestoreError(err, opType, path);
  } catch {
    // handleFirestoreError já registrou o diagnóstico estruturado com contexto Auth/Path
  }
}

/**
 * Remove propriedades `undefined` recursivamente SEM convertê-las em `null`.
 * Evita que campos não-anuláveis no `firestore.rules` (ex: `setores`, `status`,
 * `modoTransferencia`, `promotorNome`) virem `null` e causem `permission-denied`.
 */
export function omitUndefinedForFirestore<T>(obj: T): T {
  if (obj === undefined) return undefined as T;
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'number' && Number.isNaN(obj)) return 0 as unknown as T;
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj
      .filter((item) => item !== undefined)
      .map((item) => omitUndefinedForFirestore(item)) as unknown as T;
  }
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj as Record<string, any>)) {
    if (v === undefined) continue;
    if (typeof v === 'number' && Number.isNaN(v)) continue;
    result[k] = omitUndefinedForFirestore(v);
  }
  return result as T;
}

const VALID_PROMOTOR_STATUSES = new Set([
  'ATIVO',
  'BLOQUEADO',
  'DESVINCULADO',
  'PENDENTE_VINCULO',
  'INATIVO',
]);
const VALID_VINCULO_DISP_STATUSES = new Set([
  'AGUARDANDO',
  'UTILIZADO',
  'EXPIRADO',
  'CANCELADO',
]);
const VALID_MODOS_TRANSFERENCIA = new Set(['TODAS', 'MANUAL', 'NENHUMA']);

function clipStr(val: unknown, maxLen: number): string | undefined {
  if (typeof val !== 'string') return undefined;
  return val.length > maxLen ? val.slice(0, maxLen) : val;
}

function clipNullableStr(val: unknown, maxLen: number): string | null | undefined {
  if (val === undefined) return undefined;
  if (val === null) return null;
  const s = String(val);
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function sanitizeStringList(val: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(val)) return undefined;
  return val
    .filter((item) => item !== undefined && item !== null && String(item).trim().length > 0)
    .map((item) => String(item))
    .slice(0, maxItems);
}

export function buildFirestorePromotorPayload(
  promotor: Promotor,
  updatedAtIso?: string
): Record<string, any> {
  const agora = updatedAtIso || promotor.atualizadoEm || new Date().toISOString();
  const setores = sanitizeStringList(promotor.setores, 10);
  const status =
    promotor.status && VALID_PROMOTOR_STATUSES.has(promotor.status)
      ? promotor.status
      : undefined;

  return omitUndefinedForFirestore({
    promotorId: String(promotor.promotorId).slice(0, 128),
    nome: String(promotor.nome || 'PROMOTOR').trim().slice(0, 150),
    agenciaId: clipNullableStr(promotor.agenciaId, 128),
    agenciaNome: clipNullableStr(promotor.agenciaNome, 150),
    matricula: clipNullableStr(promotor.matricula, 40),
    filialId: FILIAL_COMERCIAL_ID,
    filialNome: clipNullableStr(promotor.filialNome || 'Cascavel', 80),
    setores: setores && setores.length > 0 ? setores : undefined,
    setorId: clipStr(promotor.setorId, 80),
    setorNome: clipStr(promotor.setorNome, 80),
    status,
    permissoes:
      promotor.permissoes && typeof promotor.permissoes === 'object'
        ? promotor.permissoes
        : undefined,
    dispositivoVinculado:
      promotor.dispositivoVinculado === null
        ? null
        : promotor.dispositivoVinculado && typeof promotor.dispositivoVinculado === 'object'
          ? promotor.dispositivoVinculado
          : undefined,
    dataCadastro: clipStr(promotor.dataCadastro, 60),
    dataVinculo: clipNullableStr(promotor.dataVinculo, 60),
    ultimoAcesso: clipNullableStr(promotor.ultimoAcesso, 60),
    ultimaSincronizacao: clipNullableStr(promotor.ultimaSincronizacao, 60),
    inativadoEm: clipNullableStr(promotor.inativadoEm, 60),
    reativadoEm: clipNullableStr(promotor.reativadoEm, 60),
    motivoInativacao: clipNullableStr(promotor.motivoInativacao, 300),
    substituidoPorPromotorId: clipNullableStr(promotor.substituidoPorPromotorId, 128),
    substituidoPorPromotorNome: clipNullableStr(promotor.substituidoPorPromotorNome, 150),
    criadoPor: clipNullableStr(promotor.criadoPor, 120),
    atualizadoPor: clipNullableStr(promotor.atualizadoPor, 120),
    atualizadoEm: clipNullableStr(agora, 60),
  });
}

export function buildFirestoreAgenciaPayload(
  agencia: AgenciaComercial,
  updatedAtIso?: string
): Record<string, any> {
  const agora = updatedAtIso || agencia.atualizadoEm || new Date().toISOString();
  return omitUndefinedForFirestore({
    agenciaId: String(agencia.agenciaId).slice(0, 128),
    nome: String(agencia.nome || 'AGÊNCIA').trim().slice(0, 150),
    nomeNormalizado: clipStr(agencia.nomeNormalizado || normalizarChaveAgencia(agencia.nome), 150),
    filialId: FILIAL_COMERCIAL_ID,
    ativo: typeof agencia.ativo === 'boolean' ? agencia.ativo : true,
    cnpj: clipNullableStr(agencia.cnpj, 30),
    telefone: clipNullableStr(agencia.telefone, 40),
    contato: clipNullableStr(agencia.contato, 150),
    observacoes: clipNullableStr(agencia.observacoes, 500),
    criadoEm: clipStr(agencia.criadoEm, 60),
    atualizadoEm: clipStr(agora, 60),
    totalPromotores:
      typeof agencia.totalPromotores === 'number' && !Number.isNaN(agencia.totalPromotores)
        ? agencia.totalPromotores
        : undefined,
    totalPromotoresAtivos:
      typeof agencia.totalPromotoresAtivos === 'number' && !Number.isNaN(agencia.totalPromotoresAtivos)
        ? agencia.totalPromotoresAtivos
        : undefined,
    totalIndustrias:
      typeof agencia.totalIndustrias === 'number' && !Number.isNaN(agencia.totalIndustrias)
        ? agencia.totalIndustrias
        : undefined,
  });
}

export function buildFirestoreVinculoIndustriaPayload(
  vinculo: VinculoPromotorIndustria,
  options?: {
    ativo?: boolean;
    atualizadoEm?: string;
    industriaRazaoSocial?: string;
    agenciaId?: string | null;
    usuario?: string;
  }
): Record<string, any> {
  const cnpjNorm = normalizarCnpj(vinculo.cnpj);
  const agora = options?.atualizadoEm || vinculo.atualizadoEm || new Date().toISOString();
  const ativo = options?.ativo !== undefined ? options.ativo : vinculo.ativo !== false;
  const agId =
    options?.agenciaId !== undefined
      ? options.agenciaId
      : !isAgenciaSemVinculoNome(vinculo.agenciaNome)
        ? gerarAgenciaId(vinculo.agenciaNome)
        : null;

  return omitUndefinedForFirestore({
    id: String(vinculo.id).slice(0, 128),
    vinculoId: String(vinculo.id).slice(0, 128),
    promotorId: String(vinculo.promotorId).slice(0, 128),
    promotorNome: String(vinculo.promotorNome || '').slice(0, 150),
    agenciaId: agId ? String(agId).slice(0, 128) : null,
    agenciaNome: String(vinculo.agenciaNome || '').slice(0, 150),
    industriaId: cnpjNorm ? cnpjNorm.slice(0, 128) : undefined,
    cnpj: cnpjNorm,
    cnpjFormatado: formatarCnpj(cnpjNorm),
    industriaRazaoSocial: options?.industriaRazaoSocial
      ? String(options.industriaRazaoSocial).slice(0, 200)
      : undefined,
    filialId: FILIAL_COMERCIAL_ID,
    ativo,
    criadoEm: String(vinculo.criado_em || agora).slice(0, 60),
    atualizadoEm: String(agora).slice(0, 60),
    criadoPor: String(options?.usuario || 'SISTEMA_PRINCIPAL').slice(0, 120),
    atualizadoPor: String(options?.usuario || 'SISTEMA_PRINCIPAL').slice(0, 120),
  });
}

export function buildFirestoreVinculoAgenciaPayload(
  promotor: Promotor,
  updatedAtIso?: string,
  usuario?: string
): Record<string, any> {
  const filialId = FILIAL_COMERCIAL_ID;
  const temAgencia =
    !isAgenciaSemVinculoNome(promotor.agenciaNome) &&
    Boolean(promotor.agenciaId || promotor.agenciaNome);
  const agenciaId = temAgencia
    ? promotor.agenciaId || gerarAgenciaId(promotor.agenciaNome)
    : null;
  const agora = updatedAtIso || promotor.atualizadoEm || new Date().toISOString();
  const id = `pa_${promotor.promotorId}_${filialId}`.slice(0, 128);

  return omitUndefinedForFirestore({
    id,
    vinculoId: id,
    promotorId: String(promotor.promotorId).slice(0, 128),
    promotorNome: String(promotor.nome || '').slice(0, 150),
    agenciaId: agenciaId ? String(agenciaId).slice(0, 128) : null,
    agenciaNome: temAgencia ? String(promotor.agenciaNome || '').slice(0, 150) : '',
    filialId,
    ativo: temAgencia && promotor.status !== 'INATIVO',
    criadoEm: String(promotor.dataCadastro || agora).slice(0, 60),
    atualizadoEm: String(agora).slice(0, 60),
    criadoPor: String(usuario || 'SISTEMA_PRINCIPAL').slice(0, 120),
    atualizadoPor: String(usuario || 'SISTEMA_PRINCIPAL').slice(0, 120),
  });
}

export function buildFirestoreVinculoDispositivoPayload(
  vinculo: VinculoPromotor,
  updatedAtIso?: string
): Record<string, any> {
  const agora =
    updatedAtIso ||
    vinculo.atualizadoEm ||
    vinculo.dataUtilizacao ||
    vinculo.dataCriacao ||
    new Date().toISOString();
  const setores = sanitizeStringList(vinculo.setores, 10);
  const status =
    vinculo.status && VALID_VINCULO_DISP_STATUSES.has(vinculo.status)
      ? vinculo.status
      : 'AGUARDANDO';

  return omitUndefinedForFirestore({
    vinculoId: String(vinculo.vinculoId).slice(0, 128),
    promotorId: String(vinculo.promotorId).slice(0, 128),
    promotorNome: clipStr(vinculo.promotorNome, 150),
    agenciaNome: clipStr(vinculo.agenciaNome, 150),
    filialId: FILIAL_COMERCIAL_ID,
    filialNome: clipStr(vinculo.filialNome || 'Cascavel', 80),
    setores: setores && setores.length > 0 ? setores : undefined,
    setorId: clipStr(vinculo.setorId, 80),
    setorNome: clipStr(vinculo.setorNome, 80),
    permissoes:
      vinculo.permissoes && typeof vinculo.permissoes === 'object'
        ? vinculo.permissoes
        : undefined,
    codigoVinculo: String(vinculo.codigoVinculo).slice(0, 20),
    tokenVinculo: clipNullableStr(vinculo.tokenVinculo, 128),
    dataCriacao: clipStr(vinculo.dataCriacao, 60),
    dataExpiracao: clipStr(vinculo.dataExpiracao, 60),
    status,
    dispositivoId: clipNullableStr(vinculo.dispositivoId, 128),
    dispositivoNome: clipNullableStr(vinculo.dispositivoNome, 150),
    dataUtilizacao: clipNullableStr(vinculo.dataUtilizacao, 60),
    atualizadoEm: clipStr(agora, 60),
  });
}

export function buildFirestoreMovimentacaoPayload(
  mov: HistoricoMovimentacaoComercial
): Record<string, any> {
  const modoTransferencia =
    mov.modoTransferencia && VALID_MODOS_TRANSFERENCIA.has(mov.modoTransferencia)
      ? mov.modoTransferencia
      : undefined;

  return omitUndefinedForFirestore({
    id: String(mov.id).slice(0, 128),
    filialId: FILIAL_COMERCIAL_ID,
    tipo: String(mov.tipo || 'MOVIMENTACAO').slice(0, 60),
    dataHora: String(mov.dataHora || new Date().toISOString()).slice(0, 60),
    atualizadoEm: clipNullableStr(mov.dataHora || new Date().toISOString(), 60),
    promotorId: clipNullableStr(mov.promotorId, 128),
    promotorNome: clipNullableStr(mov.promotorNome, 150),
    promotorSubstitutoId: clipNullableStr(mov.promotorSubstitutoId, 128),
    promotorSubstitutoNome: clipNullableStr(mov.promotorSubstitutoNome, 150),
    agenciaId: clipNullableStr(mov.agenciaId, 128),
    agenciaNome: clipNullableStr(mov.agenciaNome, 150),
    agenciaAnteriorId: clipNullableStr(mov.agenciaAnteriorId, 128),
    agenciaAnteriorNome: clipNullableStr(mov.agenciaAnteriorNome, 150),
    cnpjsTransferidos: sanitizeStringList(mov.cnpjsTransferidos, 500),
    industriasTransferidas: sanitizeStringList(mov.industriasTransferidas, 500),
    cnpjsOrigemAntes: sanitizeStringList(mov.cnpjsOrigemAntes, 500),
    cnpjsIgnoradosDuplicidade: sanitizeStringList(mov.cnpjsIgnoradosDuplicidade, 500),
    modoTransferencia,
    inativacaoOrigem:
      typeof mov.inativacaoOrigem === 'boolean' ? mov.inativacaoOrigem : undefined,
    motivo: clipNullableStr(mov.motivo, 500),
    detalhes: String(mov.detalhes || 'Movimentação comercial').slice(0, 1000),
    realizadoPor: String(mov.realizadoPor || 'GERENCIA_172').slice(0, 120),
  });
}

/**
 * Higieniza payloads antigos/em fila antes de gravar no Firestore, garantindo
 * conformidade estrita com `firestore.rules` mesmo após upgrade de versão.
 */
export function sanitizeComercialWriteOpPayload(
  collectionName: string,
  payload: Record<string, any>
): Record<string, any> {
  if (!payload || typeof payload !== 'object') return {};
  if (collectionName === 'promotores') {
    return buildFirestorePromotorPayload(payload as Promotor, payload.atualizadoEm);
  }
  if (collectionName === 'agencias') {
    return buildFirestoreAgenciaPayload(payload as AgenciaComercial, payload.atualizadoEm);
  }
  if (
    collectionName === 'vinculos_promotor_industria' ||
    collectionName === 'vinculosPromotorIndustria'
  ) {
    return buildFirestoreVinculoIndustriaPayload(
      {
        id: String(payload.id || payload.vinculoId || ''),
        promotorId: String(payload.promotorId || ''),
        promotorNome: String(payload.promotorNome || ''),
        agenciaNome: String(payload.agenciaNome || ''),
        cnpj: String(payload.cnpj || payload.industriaId || ''),
        filialId: FILIAL_COMERCIAL_ID,
        criado_em: String(payload.criadoEm || payload.criado_em || payload.atualizadoEm || new Date().toISOString()),
        atualizadoEm: payload.atualizadoEm,
        ativo: payload.ativo !== false,
      },
      {
        ativo: payload.ativo !== false,
        atualizadoEm: payload.atualizadoEm,
        industriaRazaoSocial: payload.industriaRazaoSocial || undefined,
        agenciaId: payload.agenciaId ?? null,
        usuario: payload.atualizadoPor || payload.criadoPor,
      }
    );
  }
  if (collectionName === 'vinculosPromotorAgencia') {
    return omitUndefinedForFirestore({
      id: clipStr(payload.id || payload.vinculoId, 128),
      vinculoId: clipStr(payload.vinculoId || payload.id, 128),
      promotorId: clipStr(payload.promotorId, 128),
      promotorNome: String(payload.promotorNome || '').slice(0, 150),
      agenciaId: clipNullableStr(payload.agenciaId, 128),
      agenciaNome: clipNullableStr(payload.agenciaNome, 150),
      filialId: FILIAL_COMERCIAL_ID,
      ativo: typeof payload.ativo === 'boolean' ? payload.ativo : true,
      criadoEm: clipStr(payload.criadoEm, 60),
      atualizadoEm: clipStr(payload.atualizadoEm, 60),
      criadoPor: clipStr(payload.criadoPor, 120),
      atualizadoPor: clipStr(payload.atualizadoPor, 120),
    });
  }
  if (collectionName === 'vinculosPromotor' || collectionName === 'vinculos_promotores') {
    return buildFirestoreVinculoDispositivoPayload(payload as VinculoPromotor, payload.atualizadoEm);
  }
  if (collectionName === 'movimentacoes_comerciais') {
    return buildFirestoreMovimentacaoPayload(payload as HistoricoMovimentacaoComercial);
  }
  return omitUndefinedForFirestore(payload);
}

export function fromFirestoreVinculoIndustria(raw: Record<string, any>): VinculoPromotorIndustria | null {
  if (!raw || !raw.promotorId || !(raw.cnpj || raw.industriaId)) return null;
  const cnpjNorm = normalizarCnpj(String(raw.cnpj || raw.industriaId));
  if (!cnpjNorm) return null;
  const filialId = String(raw.filialId || FILIAL_COMERCIAL_ID);
  const id = String(raw.id || raw.vinculoId || `${raw.promotorId}_${cnpjNorm}_${filialId}`);
  return {
    id,
    promotorId: String(raw.promotorId),
    promotorNome: String(raw.promotorNome || ''),
    agenciaNome: String(raw.agenciaNome || ''),
    cnpj: cnpjNorm,
    filialId,
    criado_em: String(raw.criadoEm || raw.criado_em || raw.atualizadoEm || new Date().toISOString()),
    atualizadoEm: raw.atualizadoEm ? String(raw.atualizadoEm) : undefined,
    ativo: raw.ativo !== false,
  };
}

function createDefaultAdapter(): ComercialSyncAdapter {
  return {
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    isQuotaExceeded: () => isFirestoreQuotaExceeded(),
    isQuotaError: (err: unknown) => isQuotaError(err),
    markQuotaExceeded: (motivo?: string, recurso?: QuotaResourceType) =>
      markQuotaExceeded(motivo, recurso),
    detectQuotaResourceType: (err: unknown) => detectQuotaResourceType(err),
    isGerenciaAdmin: () => authRoleService.isGerenciaAdminVerificadaNoServidor(),
    getUsuarioAtual: () => authRoleService.getUsuarioAtual().nome || 'GERENCIA_172',
    ensureAuth: () => ensureAuth(),
    getMeta: dbGetMeta,
    setMeta: dbSetMeta,
    getPointerDoc: async (filialId: string) => {
      if (!db) return null;
      const ref = doc(db, 'filiais', filialId, 'config', META_DOC_SYNC_COMERCIAL);
      const snap = await getDoc(ref);
      logFirestoreRead('getPointerComercial', `filiais/${filialId}/config/${META_DOC_SYNC_COMERCIAL}`, snap.exists() ? 1 : 0);
      return snap.exists() ? (snap.data() as ComercialSyncPointerDoc) : null;
    },
    subscribePointerDoc: (filialId, onData, onError) => {
      if (!db) return null;
      const ref = doc(db, 'filiais', filialId, 'config', META_DOC_SYNC_COMERCIAL);
      return onSnapshot(
        ref,
        (snap) => {
          logFirestoreRead('pointerComercialListener', `filiais/${filialId}/config/${META_DOC_SYNC_COMERCIAL}`, snap.exists() ? 1 : 0);
          onData(snap.exists() ? (snap.data() as ComercialSyncPointerDoc) : null);
        },
        (err) => {
          onError(err);
        }
      );
    },
    fetchCollection: async (collectionName, sinceIso, maxLimit) => {
      if (!db) return [];
      const colRef = collection(db, collectionName);
      const pageSize = Math.max(1, maxLimit || DEFAULT_FETCH_LIMIT);
      const MAX_PAGES = 20;
      const rows: Array<Record<string, any>> = [];
      let lastDoc: QueryDocumentSnapshot | null = null;
      let totalReads = 0;

      for (let page = 0; page < MAX_PAGES; page++) {
        const q = sinceIso
          ? lastDoc
            ? query(
                colRef,
                where('atualizadoEm', '>=', sinceIso),
                orderBy('atualizadoEm', 'asc'),
                startAfter(lastDoc),
                limit(pageSize)
              )
            : query(
                colRef,
                where('atualizadoEm', '>=', sinceIso),
                orderBy('atualizadoEm', 'asc'),
                limit(pageSize)
              )
          : lastDoc
            ? query(colRef, orderBy('__name__'), startAfter(lastDoc), limit(pageSize))
            : query(colRef, orderBy('__name__'), limit(pageSize));

        const snap = await getDocs(q);
        totalReads += snap.size;
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (d) rows.push(d);
        });
        if (snap.size < pageSize) break;
        lastDoc = snap.docs[snap.docs.length - 1];
      }

      logFirestoreRead(
        sinceIso ? 'incrementalComercialFetch' : 'bootstrapComercialFetch',
        collectionName,
        totalReads
      );
      return rows;
    },
    writeBatchOps: async (ops: ComercialWriteOp[]) => {
      if (!db || ops.length === 0) return;
      // Respeitar limite oficial do Firestore de 500 operações por writeBatch (usando 400 por margem de segurança)
      const CHUNK_SIZE = 400;
      for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
        const slice = ops.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        for (const op of slice) {
          const ref = op.collectionName.includes('/')
            ? doc(db, ...(op.collectionName.split('/') as [string, ...string[]]), op.docId)
            : doc(db, op.collectionName, op.docId);
          const sanitized = sanitizeComercialWriteOpPayload(op.collectionName, op.payload);
          if (op.merge !== false && !op.immutableCreate) {
            batch.set(ref, sanitized, { merge: true });
          } else {
            batch.set(ref, sanitized);
          }
        }
        await batch.commit();
      }
    },
    checkDocExists: async (collectionName: string, docId: string) => {
      if (!db) return false;
      const snap = await getDoc(doc(db, collectionName, docId));
      logFirestoreRead('checkMovimentacaoExists', `${collectionName}/${docId}`, snap.exists() ? 1 : 0);
      return snap.exists();
    },
  };
}

export interface ComercialSyncServiceOptions {
  autoStart?: boolean;
  adapter?: ComercialSyncAdapter;
  bridge?: ComercialStateBridge;
}

export class ComercialSyncService {
  private _adapter: ComercialSyncAdapter;
  private _bridge: ComercialStateBridge | null = null;
  private _promotorHandlers: ComercialPromotorHandlers | null = null;
  private _isvHandlers: ComercialIsvHandlers | null = null;
  private _outbox: ComercialOutboxItem[] = [];
  private _state: ComercialSyncPersistedState = cloneDefaultState();
  private _loadedFromStorage = false;
  private _started = false;
  private _isProcessingOutbox = false;
  private _isPulling = false;
  private _pointerUnsub: Unsubscribe | null = null;
  private _authUnsub: (() => void) | null = null;
  private _quotaUnsub: (() => void) | null = null;
  private _onlineHandler: (() => void) | null = null;
  private _ultimaAlteracaoRemotaIso: string | null = null;
  private _ultimoErro: string | undefined = undefined;
  private _statusListeners = new Set<(status: ComercialSyncStatus) => void>();

  constructor(options?: ComercialSyncServiceOptions) {
    this._adapter = options?.adapter ?? createDefaultAdapter();
    this._bridge = options?.bridge ?? null;

    if (options?.autoStart !== false) {
      this._quotaUnsub = subscribeQuotaStatus((qState) => {
        if (qState.bloqueado) {
          this._stopPointerListener();
        }
        this._notifyStatus();
      });
    }
  }

  public setBridge(bridge: ComercialStateBridge): void {
    this._bridge = bridge;
  }

  public registerPromotorHandlers(handlers: ComercialPromotorHandlers): void {
    this._promotorHandlers = handlers;
  }

  public registerIsvHandlers(handlers: ComercialIsvHandlers): void {
    this._isvHandlers = handlers;
  }

  private _getResolvedBridge(): ComercialStateBridge | null {
    if (this._bridge) return this._bridge;
    if (!this._promotorHandlers && !this._isvHandlers) return null;
    return {
      ensureReady: async () => {
        await Promise.all([
          this._promotorHandlers?.ensureReady?.(),
          this._isvHandlers?.ensureReady?.(),
        ]);
      },
      getSnapshot: () => ({
        promotores: this._promotorHandlers?.getPromotores() ?? [],
        agencias: this._promotorHandlers?.getAgencias() ?? [],
        vinculosDispositivo: this._promotorHandlers?.getVinculosDispositivo() ?? [],
        historicoMovimentacoes: this._promotorHandlers?.getHistoricoMovimentacoes() ?? [],
        vinculosIndustria: this._isvHandlers?.getVinculosIndustria() ?? [],
        industrias: this._isvHandlers?.getIndustrias() ?? [],
      }),
      applyMergedState: async (params) => {
        if (
          this._promotorHandlers &&
          (params.promotores ||
            params.agencias ||
            params.vinculosDispositivo ||
            params.historicoMovimentacoes)
        ) {
          await this._promotorHandlers.applyRemoteChanges({
            promotores: params.promotores,
            agencias: params.agencias,
            vinculosDispositivo: params.vinculosDispositivo,
            historicoMovimentacoes: params.historicoMovimentacoes,
          });
        }
        if (this._isvHandlers && params.vinculosIndustria) {
          await this._isvHandlers.applyRemoteChanges({
            vinculosIndustria: params.vinculosIndustria,
          });
        }
      },
    };
  }

  private async _waitForHandlersReady(bridge: ComercialStateBridge | null): Promise<void> {
    if (!bridge?.ensureReady) return;
    try {
      await bridge.ensureReady();
    } catch {
      // Handler individual já trata fallback de inicialização
    }
  }

  public getStatus(): ComercialSyncStatus {
    const online = this._adapter.isOnline();
    const isGerencia = this._adapter.isGerenciaAdmin();
    const quotaBloqueada = this._adapter.isQuotaExceeded();
    const pendentesCount = this._outbox.length;

    let estado: ComercialEstadoSync = 'SINCRONIZADO';
    if (quotaBloqueada) {
      estado = 'BLOQUEADO_COTA';
    } else if (this._isProcessingOutbox || this._isPulling) {
      estado = 'SINCRONIZANDO';
    } else if (!online) {
      estado = 'OFFLINE';
    } else if (pendentesCount > 0 && !isGerencia) {
      estado = 'AGUARDANDO_GERENCIA';
    } else if (pendentesCount > 0) {
      estado = this._ultimoErro ? 'ERRO' : 'PENDENTE_ENVIO';
    } else if (this._ultimoErro) {
      estado = 'ERRO';
    }

    return {
      estado,
      emAndamento: this._isProcessingOutbox || this._isPulling,
      online,
      isGerenciaAutenticada: isGerencia,
      pendentesCount,
      ultimaSincronizacaoIso: this._state.ultimaSincronizacaoIso,
      ultimoErro: this._ultimoErro,
      ultimaAlteracaoRemotaIso: this._ultimaAlteracaoRemotaIso,
    };
  }

  public subscribeStatus(listener: (status: ComercialSyncStatus) => void): () => void {
    this._statusListeners.add(listener);
    listener(this.getStatus());
    return () => {
      this._statusListeners.delete(listener);
    };
  }

  private _notifyStatus(): void {
    const snap = this.getStatus();
    this._statusListeners.forEach((l) => {
      try {
        l(snap);
      } catch (err) {
        console.warn('[ComercialSync] Erro ao notificar listener de status:', err);
      }
    });
  }

  private async _ensureLoaded(): Promise<void> {
    if (this._loadedFromStorage) return;
    try {
      const [outboxRaw, stateRaw] = await Promise.all([
        this._adapter.getMeta<ComercialOutboxItem[]>(META_KEY_OUTBOX, []),
        this._adapter.getMeta<Partial<ComercialSyncPersistedState> | null>(META_KEY_SYNC_STATE, null),
      ]);
      this._outbox = Array.isArray(outboxRaw)
        ? outboxRaw.map((item) => ({
            ...item,
            operations: Array.isArray(item.operations)
              ? item.operations.map((op) => ({
                  ...op,
                  payload: sanitizeComercialWriteOpPayload(op.collectionName, op.payload),
                }))
              : [],
          }))
        : [];
      if (stateRaw && typeof stateRaw === 'object') {
        this._state = {
          bootstrapCompleted: Boolean(stateRaw.bootstrapCompleted),
          initialCloudReconciled: Boolean(stateRaw.initialCloudReconciled),
          needsReconciliation: Boolean(stateRaw.needsReconciliation),
          cursors: {
            ...DEFAULT_PERSISTED_STATE.cursors,
            ...(stateRaw.cursors || {}),
          },
          lastPointerSeen: { ...(stateRaw.lastPointerSeen || {}) },
          tombstonesVinculosIndustria: { ...(stateRaw.tombstonesVinculosIndustria || {}) },
          ultimaSincronizacaoIso: stateRaw.ultimaSincronizacaoIso || null,
        };
      }
      const firstErr = this._outbox.find((item) => item.ultimoErro)?.ultimoErro;
      if (firstErr) {
        this._ultimoErro = firstErr;
      }
    } catch {
      this._outbox = [];
      this._state = cloneDefaultState();
    }
    this._loadedFromStorage = true;
  }

  public async marcarReconciliacaoPendente(): Promise<void> {
    await this._ensureLoaded();
    this._state.needsReconciliation = true;
    await this._persistState();
    this._notifyStatus();
  }

  private async _persistOutbox(): Promise<void> {
    await this._adapter.setMeta(META_KEY_OUTBOX, this._outbox).catch(() => {});
  }

  private async _persistState(): Promise<void> {
    await this._adapter.setMeta(META_KEY_SYNC_STATE, this._state).catch(() => {});
  }

  private _getLockedEntityKeys(): Set<string> {
    const locked = new Set<string>();
    for (const item of this._outbox) {
      for (const k of item.entityKeys) {
        locked.add(k);
      }
    }
    return locked;
  }

  /**
   * Inicia listener em tempo real leve do ponteiro comercial + evento `online` + mudança de Auth.
   */
  public async iniciar(): Promise<void> {
    await this._ensureLoaded();
    await this._waitForHandlersReady(this._getResolvedBridge());

    if (!this._started) {
      this._started = true;

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        this._onlineHandler = () => {
          this._notifyStatus();
          if (!this._adapter.isQuotaExceeded()) {
            void this.sincronizarAgora();
          }
        };
        window.addEventListener('online', this._onlineHandler);
      }

      this._authUnsub = authRoleService.subscribe(() => {
        this._notifyStatus();
        const isGerencia = this._adapter.isGerenciaAdmin();
        if (isGerencia && !this._adapter.isQuotaExceeded() && this._adapter.isOnline()) {
          void this.sincronizarAgora();
        }
      });
    }

    this._startPointerListener();

    if (this._adapter.isOnline() && !this._adapter.isQuotaExceeded()) {
      await this.sincronizarAgora().catch(() => {});
    } else {
      this._notifyStatus();
    }
  }

  public dispose(): void {
    this._stopPointerListener();
    if (this._authUnsub) {
      try { this._authUnsub(); } catch {}
      this._authUnsub = null;
    }
    if (this._quotaUnsub) {
      try { this._quotaUnsub(); } catch {}
      this._quotaUnsub = null;
    }
    if (this._onlineHandler && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', this._onlineHandler);
      this._onlineHandler = null;
    }
    this._started = false;
  }

  private _stopPointerListener(): void {
    if (this._pointerUnsub) {
      try { this._pointerUnsub(); } catch {}
      this._pointerUnsub = null;
    }
  }

  private _startPointerListener(): void {
    if (this._pointerUnsub || this._adapter.isQuotaExceeded()) return;
    try {
      this._pointerUnsub = this._adapter.subscribePointerDoc(
        FILIAL_COMERCIAL_ID,
        (pointer) => {
          if (pointer?.ultimaAlteracaoEm) {
            this._ultimaAlteracaoRemotaIso = pointer.ultimaAlteracaoEm;
          }
          if (pointer && this._hasRemoteDelta(pointer)) {
            void this.puxarAlteracoesIncrementais(pointer);
          } else {
            this._notifyStatus();
          }
        },
        (err) => {
          if (this._adapter.isQuotaError(err)) {
            this._adapter.markQuotaExceeded(
              (err as any)?.message,
              this._adapter.detectQuotaResourceType(err)
            );
            this._stopPointerListener();
          } else {
            reportPermissionDiagnostic(
              err,
              OperationType.GET,
              `filiais/${FILIAL_COMERCIAL_ID}/config/${META_DOC_SYNC_COMERCIAL}`
            );
          }
          this._notifyStatus();
        }
      );
    } catch {
      // Ambiente offline / sem Firestore inicializado
    }
  }

  private _hasRemoteDelta(pointer: ComercialSyncPointerDoc | null): boolean {
    if (!pointer) return !this._state.bootstrapCompleted;
    if (!this._state.bootstrapCompleted) return true;

    const checks: Array<[ComercialSyncDomain, string | undefined]> = [
      ['promotores', pointer.promotoresUpdatedAt],
      ['agencias', pointer.agenciasUpdatedAt],
      ['vinculos_promotor_industria', pointer.vinculosIndustriaUpdatedAt],
      ['vinculosPromotorAgencia', pointer.vinculosAgenciaUpdatedAt],
      ['movimentacoes_comerciais', pointer.movimentacoesUpdatedAt],
    ];
    if (this._adapter.isGerenciaAdmin()) {
      checks.push(['vinculos_dispositivo', pointer.vinculosDispositivoUpdatedAt]);
    }

    return checks.some(([domain, remoteTs]) => {
      if (!remoteTs) return false;
      const seen = this._state.lastPointerSeen[domain] || this._state.cursors[domain];
      return !seen || remoteTs > seen;
    });
  }

  // =========================================================================
  // ENFILEIRAMENTO DE MUTAÇÕES COMERCIAIS (OFFLINE-FIRST + COALESCÊNCIA)
  // =========================================================================

  public getPendingCount(): number {
    return this._outbox.length;
  }

  public getOutboxSnapshot(): ComercialOutboxItem[] {
    return this._outbox.map((item) => ({
      ...item,
      entityKeys: [...item.entityKeys],
      pointerDomains: [...item.pointerDomains],
      operations: item.operations.map((op) => ({ ...op, payload: { ...op.payload } })),
    }));
  }

  public async enqueueOperations(params: {
    domain: ComercialSyncDomain | 'batch_substituicao';
    entityKeys: string[];
    pointerDomains: ComercialSyncDomain[];
    operations: ComercialWriteOp[];
    coalesceSingleDocKey?: string;
    flushImmediately?: boolean;
  }): Promise<void> {
    await this._ensureLoaded();

    const agora = new Date().toISOString();
    const isDeferredAtEnqueue =
      !this._adapter.isOnline() ||
      !this._adapter.isGerenciaAdmin() ||
      this._adapter.isQuotaExceeded() ||
      params.flushImmediately === false;
    const nextItem: ComercialOutboxItem = {
      opId: `csop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      domain: params.domain,
      criadoEmIso: agora,
      entityKeys: params.entityKeys,
      pointerDomains: Array.from(new Set(params.pointerDomains)),
      operations: params.operations,
      tentativas: 0,
      queuedWhileDeferred: isDeferredAtEnqueue,
    };

    if (params.coalesceSingleDocKey) {
      const idx = this._outbox.findIndex(
        (existing) =>
          existing.domain === params.domain &&
          existing.entityKeys.length === 1 &&
          existing.entityKeys[0] === params.coalesceSingleDocKey
      );
      if (idx >= 0) {
        this._outbox[idx] = {
          ...nextItem,
          opId: this._outbox[idx].opId,
        };
      } else {
        this._outbox.push(nextItem);
      }
    } else {
      this._outbox.push(nextItem);
    }

    // Se for uma remoção de vínculo promotor x indústria, registrar tombstone local
    for (const op of params.operations) {
      if (
        op.collectionName === 'vinculos_promotor_industria' &&
        op.payload?.ativo === false &&
        op.docId
      ) {
        this._state.tombstonesVinculosIndustria[op.docId] =
          String(op.payload.atualizadoEm || agora);
      } else if (
        op.collectionName === 'vinculos_promotor_industria' &&
        op.payload?.ativo !== false &&
        op.docId
      ) {
        delete this._state.tombstonesVinculosIndustria[op.docId];
      }
    }

    await Promise.all([this._persistOutbox(), this._persistState()]);
    this._notifyStatus();

    if (
      params.flushImmediately !== false &&
      this._adapter.isOnline() &&
      this._adapter.isGerenciaAdmin() &&
      !this._adapter.isQuotaExceeded()
    ) {
      await this.processarFilaPendente();
    }
  }

  public async registrarPromotorSync(promotor: Promotor, incluirVinculoAgencia = true): Promise<void> {
    const agora = promotor.atualizadoEm || new Date().toISOString();
    const ops: ComercialWriteOp[] = [
      {
        collectionName: 'promotores',
        docId: promotor.promotorId,
        payload: buildFirestorePromotorPayload(promotor, agora),
        merge: true,
      },
    ];
    const entityKeys = [`promotores:${promotor.promotorId}`];
    const pointerDomains: ComercialSyncDomain[] = ['promotores'];

    if (incluirVinculoAgencia) {
      const va = buildFirestoreVinculoAgenciaPayload(promotor, agora, this._adapter.getUsuarioAtual());
      ops.push({
        collectionName: 'vinculosPromotorAgencia',
        docId: va.id,
        payload: va,
        merge: true,
      });
      entityKeys.push(`vinculosPromotorAgencia:${va.id}`);
      pointerDomains.push('vinculosPromotorAgencia');
    }

    await this.enqueueOperations({
      domain: ops.length === 1 ? 'promotores' : 'batch_substituicao',
      entityKeys,
      pointerDomains,
      operations: ops,
      coalesceSingleDocKey: ops.length === 1 ? `promotores:${promotor.promotorId}` : undefined,
    });
  }

  public async registrarAgenciaSync(
    agencia: AgenciaComercial,
    promotoresAtualizados: Promotor[] = []
  ): Promise<void> {
    const agora = agencia.atualizadoEm || new Date().toISOString();
    const ops: ComercialWriteOp[] = [
      {
        collectionName: 'agencias',
        docId: agencia.agenciaId,
        payload: buildFirestoreAgenciaPayload(agencia, agora),
        merge: true,
      },
    ];
    const entityKeys = [`agencias:${agencia.agenciaId}`];
    const pointerDomains: ComercialSyncDomain[] = ['agencias'];

    for (const p of promotoresAtualizados) {
      ops.push({
        collectionName: 'promotores',
        docId: p.promotorId,
        payload: buildFirestorePromotorPayload(p, agora),
        merge: true,
      });
      entityKeys.push(`promotores:${p.promotorId}`);
      pointerDomains.push('promotores');

      const va = buildFirestoreVinculoAgenciaPayload(p, agora, this._adapter.getUsuarioAtual());
      ops.push({
        collectionName: 'vinculosPromotorAgencia',
        docId: va.id,
        payload: va,
        merge: true,
      });
      entityKeys.push(`vinculosPromotorAgencia:${va.id}`);
      pointerDomains.push('vinculosPromotorAgencia');
    }

    await this.enqueueOperations({
      domain: ops.length === 1 ? 'agencias' : 'batch_substituicao',
      entityKeys,
      pointerDomains,
      operations: ops,
      coalesceSingleDocKey: ops.length === 1 ? `agencias:${agencia.agenciaId}` : undefined,
    });
  }

  public async registrarVinculoIndustriaSync(
    vinculo: VinculoPromotorIndustria,
    industria?: Industria
  ): Promise<void> {
    const agora = vinculo.atualizadoEm || vinculo.criado_em || new Date().toISOString();
    const payload = buildFirestoreVinculoIndustriaPayload(vinculo, {
      ativo: true,
      atualizadoEm: agora,
      industriaRazaoSocial: industria?.razao_social || industria?.nome_exibicao,
      usuario: this._adapter.getUsuarioAtual(),
    });
    await this.enqueueOperations({
      domain: 'vinculos_promotor_industria',
      entityKeys: [`vinculos_promotor_industria:${vinculo.id}`],
      pointerDomains: ['vinculos_promotor_industria'],
      operations: [
        {
          collectionName: 'vinculos_promotor_industria',
          docId: vinculo.id,
          payload,
          merge: true,
        },
      ],
      coalesceSingleDocKey: `vinculos_promotor_industria:${vinculo.id}`,
    });
  }

  public async registrarDesvinculoIndustriaSync(
    vinculo: VinculoPromotorIndustria,
    atualizadoEm?: string
  ): Promise<void> {
    const agora = atualizadoEm || new Date().toISOString();
    const payload = buildFirestoreVinculoIndustriaPayload(vinculo, {
      ativo: false,
      atualizadoEm: agora,
      usuario: this._adapter.getUsuarioAtual(),
    });
    await this.enqueueOperations({
      domain: 'vinculos_promotor_industria',
      entityKeys: [`vinculos_promotor_industria:${vinculo.id}`],
      pointerDomains: ['vinculos_promotor_industria'],
      operations: [
        {
          collectionName: 'vinculos_promotor_industria',
          docId: vinculo.id,
          payload,
          merge: true,
        },
      ],
      coalesceSingleDocKey: `vinculos_promotor_industria:${vinculo.id}`,
    });
  }

  public async registrarVinculosIndustriaLoteSync(
    vinculosAtualizados: VinculoPromotorIndustria[],
    vinculosRemovidos: VinculoPromotorIndustria[] = []
  ): Promise<void> {
    if (vinculosAtualizados.length === 0 && vinculosRemovidos.length === 0) return;
    const agora = new Date().toISOString();
    const usuario = this._adapter.getUsuarioAtual();
    const ops: ComercialWriteOp[] = [];
    const entityKeys: string[] = [];

    for (const v of vinculosAtualizados) {
      ops.push({
        collectionName: 'vinculos_promotor_industria',
        docId: v.id,
        payload: buildFirestoreVinculoIndustriaPayload(v, {
          ativo: true,
          atualizadoEm: v.atualizadoEm || agora,
          usuario,
        }),
        merge: true,
      });
      entityKeys.push(`vinculos_promotor_industria:${v.id}`);
    }

    for (const v of vinculosRemovidos) {
      ops.push({
        collectionName: 'vinculos_promotor_industria',
        docId: v.id,
        payload: buildFirestoreVinculoIndustriaPayload(v, {
          ativo: false,
          atualizadoEm: agora,
          usuario,
        }),
        merge: true,
      });
      entityKeys.push(`vinculos_promotor_industria:${v.id}`);
    }

    await this.enqueueOperations({
      domain: 'batch_substituicao',
      entityKeys,
      pointerDomains: ['vinculos_promotor_industria'],
      operations: ops,
    });
  }

  public async registrarVinculoDispositivoSync(vinculo: VinculoPromotor): Promise<void> {
    const agora = vinculo.atualizadoEm || new Date().toISOString();
    const payload = buildFirestoreVinculoDispositivoPayload(vinculo, agora);
    await this.enqueueOperations({
      domain: 'vinculos_dispositivo',
      entityKeys: [`vinculosPromotor:${vinculo.vinculoId}`],
      pointerDomains: ['vinculos_dispositivo'],
      operations: [
        {
          collectionName: 'vinculosPromotor',
          docId: vinculo.vinculoId,
          payload,
          merge: true,
        },
        {
          collectionName: 'vinculos_promotores',
          docId: vinculo.vinculoId,
          payload,
          merge: true,
        },
      ],
      coalesceSingleDocKey: `vinculosPromotor:${vinculo.vinculoId}`,
    });
  }

  public async registrarMovimentacaoSync(mov: HistoricoMovimentacaoComercial): Promise<void> {
    const payload = buildFirestoreMovimentacaoPayload(mov);
    await this.enqueueOperations({
      domain: 'movimentacoes_comerciais',
      entityKeys: [`movimentacoes_comerciais:${mov.id}`],
      pointerDomains: ['movimentacoes_comerciais'],
      operations: [
        {
          collectionName: 'movimentacoes_comerciais',
          docId: mov.id,
          payload,
          merge: false,
          immutableCreate: true,
        },
      ],
    });
  }

  public async registrarSubstituicaoAtomicaSync(params: {
    promotoresAlterados: Promotor[];
    vinculosDispositivoCancelados?: VinculoPromotor[];
    vinculosIndustriaCriados?: VinculoPromotorIndustria[];
    vinculosIndustriaRemovidos?: VinculoPromotorIndustria[];
    movimentacoes?: HistoricoMovimentacaoComercial[];
  }): Promise<void> {
    const agora = new Date().toISOString();
    const usuario = this._adapter.getUsuarioAtual();
    const ops: ComercialWriteOp[] = [];
    const entityKeys: string[] = [];
    const pointerDomains: ComercialSyncDomain[] = [];

    for (const p of params.promotoresAlterados) {
      ops.push({
        collectionName: 'promotores',
        docId: p.promotorId,
        payload: buildFirestorePromotorPayload(p, p.atualizadoEm || agora),
        merge: true,
      });
      entityKeys.push(`promotores:${p.promotorId}`);
      pointerDomains.push('promotores');

      const va = buildFirestoreVinculoAgenciaPayload(p, p.atualizadoEm || agora, usuario);
      ops.push({
        collectionName: 'vinculosPromotorAgencia',
        docId: va.id,
        payload: va,
        merge: true,
      });
      entityKeys.push(`vinculosPromotorAgencia:${va.id}`);
      pointerDomains.push('vinculosPromotorAgencia');
    }

    for (const vd of params.vinculosDispositivoCancelados || []) {
      const vp = buildFirestoreVinculoDispositivoPayload(vd, agora);
      ops.push({
        collectionName: 'vinculosPromotor',
        docId: vd.vinculoId,
        payload: vp,
        merge: true,
      });
      ops.push({
        collectionName: 'vinculos_promotores',
        docId: vd.vinculoId,
        payload: vp,
        merge: true,
      });
      entityKeys.push(`vinculosPromotor:${vd.vinculoId}`);
      pointerDomains.push('vinculos_dispositivo');
    }

    for (const vi of params.vinculosIndustriaCriados || []) {
      ops.push({
        collectionName: 'vinculos_promotor_industria',
        docId: vi.id,
        payload: buildFirestoreVinculoIndustriaPayload(vi, {
          ativo: true,
          atualizadoEm: vi.atualizadoEm || agora,
          usuario,
        }),
        merge: true,
      });
      entityKeys.push(`vinculos_promotor_industria:${vi.id}`);
      pointerDomains.push('vinculos_promotor_industria');
    }

    for (const vr of params.vinculosIndustriaRemovidos || []) {
      ops.push({
        collectionName: 'vinculos_promotor_industria',
        docId: vr.id,
        payload: buildFirestoreVinculoIndustriaPayload(vr, {
          ativo: false,
          atualizadoEm: agora,
          usuario,
        }),
        merge: true,
      });
      entityKeys.push(`vinculos_promotor_industria:${vr.id}`);
      pointerDomains.push('vinculos_promotor_industria');
    }

    for (const mov of params.movimentacoes || []) {
      ops.push({
        collectionName: 'movimentacoes_comerciais',
        docId: mov.id,
        payload: buildFirestoreMovimentacaoPayload(mov),
        merge: false,
        immutableCreate: true,
      });
      entityKeys.push(`movimentacoes_comerciais:${mov.id}`);
      pointerDomains.push('movimentacoes_comerciais');
    }

    if (ops.length === 0) return;

    await this.enqueueOperations({
      domain: 'batch_substituicao',
      entityKeys,
      pointerDomains,
      operations: ops,
    });
  }

  // =========================================================================
  // PROCESSAMENTO DA FILA OUTBOX (ENVIO PARA FIRESTORE)
  // =========================================================================

  public async processarFilaPendente(): Promise<{
    enviados: number;
    pendentes: number;
    erros: number;
    erro?: string;
  }> {
    await this._ensureLoaded();

    if (this._isProcessingOutbox) {
      return { enviados: 0, pendentes: this._outbox.length, erros: 0 };
    }
    if (this._outbox.length === 0) {
      return { enviados: 0, pendentes: 0, erros: 0 };
    }
    if (!this._adapter.isOnline() || this._adapter.isQuotaExceeded()) {
      this._notifyStatus();
      return { enviados: 0, pendentes: this._outbox.length, erros: 0 };
    }
    if (!this._adapter.isGerenciaAdmin()) {
      this._notifyStatus();
      return { enviados: 0, pendentes: this._outbox.length, erros: 0 };
    }

    this._isProcessingOutbox = true;
    this._ultimoErro = undefined;
    this._notifyStatus();

    let enviados = 0;
    let erros = 0;

    try {
      await this._adapter.ensureAuth().catch(() => null);

      while (this._outbox.length > 0) {
        if (!this._adapter.isOnline() || this._adapter.isQuotaExceeded() || !this._adapter.isGerenciaAdmin()) {
          break;
        }

        const prevPointerMs = Math.max(
          Date.now(),
          this._ultimaAlteracaoRemotaIso ? Date.parse(this._ultimaAlteracaoRemotaIso) + 1 : 0,
          ...Object.values(this._state.lastPointerSeen).map((s) => (s ? Date.parse(s) + 1 : 0))
        );
        const agoraItem = new Date(Number.isNaN(prevPointerMs) ? Date.now() : prevPointerMs).toISOString();
        this._ultimaAlteracaoRemotaIso = agoraItem;

        const item = this._outbox[0];
        const pointerPatch: Record<string, any> = {
          filialId: FILIAL_COMERCIAL_ID,
          versaoEsquema: 1,
          ultimaAlteracaoEm: agoraItem,
          atualizadoPor: this._adapter.getUsuarioAtual(),
        };
        for (const d of item.pointerDomains) {
          if (d === 'promotores') pointerPatch.promotoresUpdatedAt = agoraItem;
          if (d === 'agencias') pointerPatch.agenciasUpdatedAt = agoraItem;
          if (d === 'vinculos_promotor_industria') pointerPatch.vinculosIndustriaUpdatedAt = agoraItem;
          if (d === 'vinculosPromotorAgencia') pointerPatch.vinculosAgenciaUpdatedAt = agoraItem;
          if (d === 'vinculos_dispositivo') pointerPatch.vinculosDispositivoUpdatedAt = agoraItem;
          if (d === 'movimentacoes_comerciais') pointerPatch.movimentacoesUpdatedAt = agoraItem;
        }

        const itemAgeMs = Date.now() - (Date.parse(item.criadoEmIso || '') || Date.now());
        const shouldRefreshTimestamp =
          Boolean(item.queuedWhileDeferred) ||
          (item.tentativas || 0) > 0 ||
          itemAgeMs > 10_000;

        const refreshedOps: ComercialWriteOp[] = item.operations.map((op) => {
          const sanitizedBase = sanitizeComercialWriteOpPayload(op.collectionName, op.payload);
          if (op.immutableCreate || !shouldRefreshTimestamp) {
            return { ...op, payload: sanitizedBase };
          }
          if (op.collectionName === 'vinculos_promotor_industria' && sanitizedBase?.ativo === false && op.docId) {
            this._state.tombstonesVinculosIndustria[op.docId] = agoraItem;
          }
          return {
            ...op,
            payload: {
              ...sanitizedBase,
              atualizadoEm: agoraItem,
            },
          };
        });

        const batchWithPointer: ComercialWriteOp[] = [
          ...refreshedOps,
          {
            collectionName: `filiais/${FILIAL_COMERCIAL_ID}/config`,
            docId: META_DOC_SYNC_COMERCIAL,
            payload: pointerPatch,
            merge: true,
          },
        ];

        try {
          await this._adapter.writeBatchOps(batchWithPointer);
          this._outbox.shift();
          enviados += 1;
          this._state.ultimaSincronizacaoIso = agoraItem;
          for (const d of item.pointerDomains) {
            this._state.lastPointerSeen[d] = getLatestIso(this._state.lastPointerSeen[d], agoraItem);
            this._state.cursors[d] = getLatestIso(this._state.cursors[d], agoraItem);
          }
          await Promise.all([this._persistOutbox(), this._persistState()]);
        } catch (err: any) {
          erros += 1;
          if (this._adapter.isQuotaError(err)) {
            this._adapter.markQuotaExceeded(
              err?.message,
              this._adapter.detectQuotaResourceType(err)
            );
            this._ultimoErro = 'Cota diária do Firebase Spark atingida.';
            break;
          }

          // Caso um batch tenha incluído uma movimentação imutável já existente após retry, verificar idempotência
          const isSingleImmutable =
            item.operations.length === 1 && item.operations[0].immutableCreate === true;
          if (isSingleImmutable && isPermissionDeniedError(err)) {
            const exists = await this._adapter
              .checkDocExists(item.operations[0].collectionName, item.operations[0].docId)
              .catch(() => false);
            if (exists) {
              this._outbox.shift();
              enviados += 1;
              erros -= 1;
              await this._persistOutbox();
              continue;
            }
          }

          reportPermissionDiagnostic(
            err,
            OperationType.WRITE,
            item.operations[0]
              ? `${item.operations[0].collectionName}/${item.operations[0].docId}`
              : 'comercial_sync'
          );

          item.tentativas = (item.tentativas || 0) + 1;
          item.ultimoErro = err?.message || 'Falha ao sincronizar alteração comercial.';
          this._ultimoErro = item.ultimoErro;
          await this._persistOutbox();
          break;
        }
      }
    } finally {
      this._isProcessingOutbox = false;
      this._notifyStatus();
    }

    return { enviados, pendentes: this._outbox.length, erros, erro: this._ultimoErro };
  }

  // =========================================================================
  // SINCRONIZAÇÃO INCREMENTAL (PULL + RECONCILIAÇÃO SEM SOBRESCRITA)
  // =========================================================================

  public async sincronizarAgora(options?: {
    reconciliar?: boolean;
  }): Promise<SincronizarComercialResult> {
    await this._ensureLoaded();
    await this._waitForHandlersReady(this._getResolvedBridge());

    if (!this._adapter.isOnline()) {
      this._notifyStatus();
      return {
        sucesso: false,
        enviados: 0,
        recebidos: 0,
        pendentes: this._outbox.length,
        bloqueados: 0,
        erros: 0,
        mensagem: `Dispositivo offline (${this._outbox.length} pendente(s) salvo(s) localmente no IndexedDB).`,
      };
    }

    if (this._adapter.isQuotaExceeded()) {
      this._notifyStatus();
      return {
        sucesso: false,
        enviados: 0,
        recebidos: 0,
        pendentes: this._outbox.length,
        bloqueados: this._outbox.length,
        erros: 0,
        bloqueadoMotivo: 'Cota diária do Firebase Spark aguardando liberação.',
        mensagem: `Cota diária do Firebase Spark aguardando liberação (${this._outbox.length} pendente(s) local(is)).`,
      };
    }

    this._ultimoErro = undefined;
    await this._adapter.ensureAuth().catch(() => null);

    // 1. Puxar alterações remotas e reconciliar registros ausentes entre IndexedDB e Firestore
    const pullRes = await this.puxarAlteracoesIncrementais(undefined, {
      reconciliar: Boolean(options?.reconciliar),
    });

    // 2. Enviar pendências da fila local caso usuário seja GERENCIA_ADMIN verificada
    const pushRes = await this.processarFilaPendente();

    const isGerencia = this._adapter.isGerenciaAdmin();
    const erroPullMsg =
      pullRes.errosDominios.length > 0
        ? `Falha ao consultar ${pullRes.errosDominios.map((e) => e.domain).join(', ')}: ${pullRes.errosDominios[0].mensagem}`
        : undefined;
    const erroDetalhe = pushRes.erro || erroPullMsg || this._ultimoErro;

    if (erroDetalhe && !this._ultimoErro) {
      this._ultimoErro = erroDetalhe;
      this._notifyStatus();
    }

    const totalErros = pullRes.errosDominios.length + pushRes.erros;
    const pendentesRestantes = pushRes.pendentes;
    const bloqueados = !isGerencia ? pendentesRestantes : 0;
    const aguardandoGerencia = bloqueados > 0;
    const quotaAgora = this._adapter.isQuotaExceeded();

    const sucesso =
      totalErros === 0 && pendentesRestantes === 0 && bloqueados === 0 && !quotaAgora;

    let mensagem: string;
    if (quotaAgora) {
      mensagem = `Cota diária do Firebase Spark atingida (${pushRes.enviados} envio(s), ${pullRes.recebidos} atualização(ões), ${pendentesRestantes} pendente(s)).`;
    } else if (totalErros > 0) {
      mensagem = `Erro na sincronização comercial (${pushRes.enviados} enviado(s), ${pullRes.recebidos} recebido(s), ${pendentesRestantes} pendente(s), ${totalErros} erro(s)): ${erroDetalhe}`;
    } else if (aguardandoGerencia) {
      mensagem = `${bloqueados} registro(s) local(is) bloqueado(s) aguardando login Google da Gerência para envio ao Firestore (${pushRes.enviados} enviado(s), ${pullRes.recebidos} atualização(ões) recebida(s)).`;
    } else if (pendentesRestantes > 0) {
      mensagem = `Sincronização parcial: ${pendentesRestantes} pendência(s) restante(s) (${pushRes.enviados} enviado(s), ${pullRes.recebidos} atualização(ões) recebida(s)).`;
    } else {
      mensagem = `Sincronização comercial concluída (${pushRes.enviados} envio(s), ${pullRes.recebidos} atualização(ões) recebida(s)).`;
    }

    return {
      sucesso,
      enviados: pushRes.enviados,
      recebidos: pullRes.recebidos,
      pendentes: pendentesRestantes,
      bloqueados,
      erros: totalErros,
      erroDetalhe,
      bloqueadoMotivo: aguardandoGerencia
        ? 'Login Google da Gerência necessário para gravar cadastros e vínculos no Firestore.'
        : quotaAgora
          ? 'Cota diária do Spark atingida.'
          : undefined,
      aguardandoGerencia,
      mensagem,
    };
  }

  public async puxarAlteracoesIncrementais(
    pointerPreCarregado?: ComercialSyncPointerDoc | null,
    options?: { reconciliar?: boolean }
  ): Promise<{
    recebidos: number;
    domainsConsultados: ComercialSyncDomain[];
    errosDominios: Array<{ domain: ComercialSyncDomain; mensagem: string; isPermission: boolean }>;
  }> {
    await this._ensureLoaded();

    const resolvedBridge = this._getResolvedBridge();
    await this._waitForHandlersReady(resolvedBridge);
    if (
      this._isPulling ||
      !this._adapter.isOnline() ||
      this._adapter.isQuotaExceeded() ||
      !resolvedBridge
    ) {
      return { recebidos: 0, domainsConsultados: [], errosDominios: [] };
    }

    this._isPulling = true;
    this._notifyStatus();

    const domainsConsultados: ComercialSyncDomain[] = [];
    const errosDominios: Array<{
      domain: ComercialSyncDomain;
      mensagem: string;
      isPermission: boolean;
    }> = [];
    const failedDomains = new Set<ComercialSyncDomain>();
    let recebidos = 0;

    try {
      await this._adapter.ensureAuth().catch(() => null);

      let pointer = pointerPreCarregado !== undefined ? pointerPreCarregado : null;
      let pointerReadError: string | null = null;
      if (pointerPreCarregado === undefined) {
        try {
          pointer = await this._adapter.getPointerDoc(FILIAL_COMERCIAL_ID);
          if (pointer?.ultimaAlteracaoEm) {
            this._ultimaAlteracaoRemotaIso = pointer.ultimaAlteracaoEm;
          }
        } catch (err: any) {
          if (this._adapter.isQuotaError(err)) {
            this._adapter.markQuotaExceeded(
              err?.message,
              this._adapter.detectQuotaResourceType(err)
            );
            return { recebidos: 0, domainsConsultados: [], errosDominios: [] };
          }
          pointerReadError = err?.message || 'Erro ao ler ponteiro comercial.';
          reportPermissionDiagnostic(
            err,
            OperationType.GET,
            `filiais/${FILIAL_COMERCIAL_ID}/config/${META_DOC_SYNC_COMERCIAL}`
          );
        }
      }

      const isGerencia = this._adapter.isGerenciaAdmin();
      const forceReconcile = Boolean(options?.reconciliar) || Boolean(this._state.needsReconciliation);
      const needsGerenciaInitialReconcile = !this._state.initialCloudReconciled && isGerencia;
      const isFullFetch =
        !this._state.bootstrapCompleted || needsGerenciaInitialReconcile || forceReconcile;

      const shouldFetchDomain = (
        domain: ComercialSyncDomain,
        remoteDomainTs?: string
      ): boolean => {
        if (domain === 'vinculos_dispositivo' && !isGerencia) return false;
        if (isFullFetch) return true;
        if (!remoteDomainTs) return false;
        const lastSeen = this._state.lastPointerSeen[domain] || this._state.cursors[domain];
        return !lastSeen || remoteDomainTs > lastSeen;
      };

      const fetchList = async (
        domain: ComercialSyncDomain,
        collectionName: string,
        remoteTs?: string
      ): Promise<Array<Record<string, any>>> => {
        if (!shouldFetchDomain(domain, remoteTs)) return [];
        domainsConsultados.push(domain);
        const sinceIso = isFullFetch ? null : subtractSkewIso(this._state.cursors[domain]);
        try {
          return await this._adapter.fetchCollection(collectionName, sinceIso, DEFAULT_FETCH_LIMIT);
        } catch (err: any) {
          if (this._adapter.isQuotaError(err)) {
            this._adapter.markQuotaExceeded(
              err?.message,
              this._adapter.detectQuotaResourceType(err)
            );
            throw err;
          }
          reportPermissionDiagnostic(err, OperationType.LIST, collectionName);
          failedDomains.add(domain);
          errosDominios.push({
            domain,
            mensagem: err?.message || `Falha ao consultar coleção ${collectionName}`,
            isPermission: isPermissionDeniedError(err),
          });
          return [];
        }
      };

      const [
        rawPromotores,
        rawAgencias,
        rawVinculosInd,
        rawVinculosAg,
        rawMovs,
        rawVinculosDisp,
      ] = await Promise.all([
        fetchList('promotores', 'promotores', pointer?.promotoresUpdatedAt),
        fetchList('agencias', 'agencias', pointer?.agenciasUpdatedAt),
        fetchList(
          'vinculos_promotor_industria',
          'vinculos_promotor_industria',
          pointer?.vinculosIndustriaUpdatedAt
        ),
        fetchList(
          'vinculosPromotorAgencia',
          'vinculosPromotorAgencia',
          pointer?.vinculosAgenciaUpdatedAt
        ),
        fetchList(
          'movimentacoes_comerciais',
          'movimentacoes_comerciais',
          pointer?.movimentacoesUpdatedAt
        ),
        fetchList(
          'vinculos_dispositivo',
          'vinculosPromotor',
          pointer?.vinculosDispositivoUpdatedAt
        ),
      ]);

      if (pointerReadError && domainsConsultados.length === 0) {
        errosDominios.push({
          domain: 'promotores',
          mensagem: pointerReadError,
          isPermission: pointerReadError.toLowerCase().includes('permission'),
        });
      }

      // Mesclar respeitando outbox pendente e timestamps mais novos locais
      const snapshot = resolvedBridge.getSnapshot();
      const locked = this._getLockedEntityKeys();
      const mergeResult = this._mergeRemoteSnapshots(snapshot, locked, {
        rawPromotores,
        rawAgencias,
        rawVinculosInd,
        rawVinculosAg,
        rawMovs,
        rawVinculosDisp,
      });

      recebidos = mergeResult.aplicadosCount;

      if (mergeResult.hasAnyChange) {
        await resolvedBridge.applyMergedState({
          promotores: mergeResult.nextPromotores,
          agencias: mergeResult.nextAgencias,
          vinculosIndustria: mergeResult.nextVinculosIndustria,
          vinculosDispositivo: mergeResult.nextVinculosDispositivo,
          historicoMovimentacoes: mergeResult.nextMovimentacoes,
        });
      }

      // Reconciliação bidirecional incremental (sem duplicar nem apagar dados existentes)
      if (isFullFetch && errosDominios.length === 0) {
        const snapshotAtual = resolvedBridge.getSnapshot();
        await this._reconciliarDadosLocaisVsNuvem(
          snapshotAtual,
          {
            rawPromotores,
            rawAgencias,
            rawVinculosInd,
            rawVinculosAg,
            rawMovs,
            rawVinculosDisp,
          },
          { includeDispositivos: isGerencia && !failedDomains.has('vinculos_dispositivo') }
        );
        if (isGerencia) {
          this._state.initialCloudReconciled = true;
        }
        this._state.needsReconciliation = false;
      }

      // Atualizar cursores incrementais SOMENTE para domínios sem erro
      const updateDomainCursor = (
        domain: ComercialSyncDomain,
        rows: Array<Record<string, any>>,
        pointerTs?: string
      ) => {
        if (failedDomains.has(domain)) return;
        let maxIso = this._state.cursors[domain] || '';
        for (const row of rows) {
          const cand =
            row?.atualizadoEm ||
            row?.dataHora ||
            row?.dataUtilizacao ||
            row?.dataCriacao ||
            row?.dataCadastro ||
            '';
          if (typeof cand === 'string' && cand) {
            maxIso = getLatestIso(maxIso, cand);
          }
        }
        if (pointerTs) {
          this._state.lastPointerSeen[domain] = getLatestIso(
            this._state.lastPointerSeen[domain],
            pointerTs
          );
          if (!maxIso) maxIso = pointerTs;
        }
        if (maxIso) {
          this._state.cursors[domain] = maxIso;
        }
      };

      updateDomainCursor('promotores', rawPromotores, pointer?.promotoresUpdatedAt);
      updateDomainCursor('agencias', rawAgencias, pointer?.agenciasUpdatedAt);
      updateDomainCursor(
        'vinculos_promotor_industria',
        rawVinculosInd,
        pointer?.vinculosIndustriaUpdatedAt
      );
      updateDomainCursor(
        'vinculosPromotorAgencia',
        rawVinculosAg,
        pointer?.vinculosAgenciaUpdatedAt
      );
      updateDomainCursor(
        'movimentacoes_comerciais',
        rawMovs,
        pointer?.movimentacoesUpdatedAt
      );
      if (isGerencia) {
        updateDomainCursor(
          'vinculos_dispositivo',
          rawVinculosDisp,
          pointer?.vinculosDispositivoUpdatedAt
        );
      }

      if (errosDominios.length === 0) {
        this._state.bootstrapCompleted = true;
        this._state.ultimaSincronizacaoIso = new Date().toISOString();
      } else {
        this._ultimoErro = errosDominios[0].mensagem;
      }
      await this._persistState();
    } catch (err: any) {
      if (!this._adapter.isQuotaError(err)) {
        this._ultimoErro = err?.message || 'Erro ao puxar alterações comerciais.';
      }
    } finally {
      this._isPulling = false;
      this._notifyStatus();
    }

    return { recebidos, domainsConsultados, errosDominios };
  }

  private _mergeRemoteSnapshots(
    local: ComercialLocalStateSnapshot,
    lockedKeys: Set<string>,
    remote: {
      rawPromotores: Array<Record<string, any>>;
      rawAgencias: Array<Record<string, any>>;
      rawVinculosInd: Array<Record<string, any>>;
      rawVinculosAg: Array<Record<string, any>>;
      rawMovs: Array<Record<string, any>>;
      rawVinculosDisp: Array<Record<string, any>>;
    }
  ): {
    hasAnyChange: boolean;
    aplicadosCount: number;
    nextPromotores?: Promotor[];
    nextAgencias?: AgenciaComercial[];
    nextVinculosIndustria?: VinculoPromotorIndustria[];
    nextVinculosDispositivo?: VinculoPromotor[];
    nextMovimentacoes?: HistoricoMovimentacaoComercial[];
  } {
    let hasAnyChange = false;
    let aplicadosCount = 0;

    // 1. Agências (com deduplicação por chave normalizada e ID)
    let nextAgencias: AgenciaComercial[] | undefined;
    if (remote.rawAgencias.length > 0) {
      const porId = new Map<string, AgenciaComercial>();
      const porChave = new Map<string, string>(); // nomeNormalizado -> agenciaId
      for (const ag of local.agencias) {
        porId.set(ag.agenciaId, ag);
        const chave = normalizarChaveAgencia(ag.nome);
        if (chave) porChave.set(chave, ag.agenciaId);
      }

      let agChanged = false;
      for (const raw of remote.rawAgencias) {
        if (!raw || !raw.agenciaId || !raw.nome) continue;
        const chave = normalizarChaveAgencia(raw.nome);
        if (!chave) continue;

        const existingId = porChave.get(chave) || String(raw.agenciaId);
        const localAg = porId.get(existingId);
        const isLocked =
          lockedKeys.has(`agencias:${raw.agenciaId}`) || lockedKeys.has(`agencias:${existingId}`);
        const remoteTs = extractTimestampMs(raw);
        const localTs = extractTimestampMs(localAg);

        if (localAg && isLocked && remoteTs <= localTs) continue;
        if (localAg && localTs > remoteTs) continue;

        const mergedAg: AgenciaComercial = {
          ...(localAg || {}),
          ...(raw as AgenciaComercial),
          agenciaId: localAg ? localAg.agenciaId : String(raw.agenciaId),
          nomeNormalizado: chave,
          filialId: String(raw.filialId || FILIAL_COMERCIAL_ID),
          ativo: raw.ativo !== undefined ? Boolean(raw.ativo) : true,
        };

        const isIdentical =
          Boolean(localAg) &&
          localAg!.nome === mergedAg.nome &&
          localAg!.ativo === mergedAg.ativo &&
          (localAg!.contato || '') === (mergedAg.contato || '') &&
          (localAg!.telefone || '') === (mergedAg.telefone || '') &&
          (localAg!.cnpj || '') === (mergedAg.cnpj || '') &&
          (localAg!.observacoes || '') === (mergedAg.observacoes || '') &&
          (localAg!.atualizadoEm || '') === (mergedAg.atualizadoEm || '');

        if (!isIdentical) {
          porId.set(mergedAg.agenciaId, mergedAg);
          porChave.set(chave, mergedAg.agenciaId);
          agChanged = true;
          aplicadosCount += 1;
        }
      }

      if (agChanged) {
        nextAgencias = Array.from(porId.values()).sort((a, b) =>
          a.nome.localeCompare(b.nome, 'pt-BR')
        );
        hasAnyChange = true;
      }
    }

    // 2. Promotores + reconciliação de Vínculo Promotor × Agência se mais recente
    let nextPromotores: Promotor[] | undefined;
    if (remote.rawPromotores.length > 0 || remote.rawVinculosAg.length > 0) {
      const mapProm = new Map<string, Promotor>();
      for (const p of local.promotores) {
        mapProm.set(p.promotorId, p);
      }

      let promChanged = false;

      for (const raw of remote.rawPromotores) {
        if (!raw || !raw.promotorId || !raw.nome) continue;
        const id = String(raw.promotorId);
        const localProm = mapProm.get(id);
        const isLocked = lockedKeys.has(`promotores:${id}`);
        const remoteTs = extractTimestampMs(raw);
        const localTs = extractTimestampMs(localProm);

        if (localProm && isLocked && remoteTs <= localTs) continue;
        if (localProm && localTs > remoteTs) continue;

        const nextProm = raw as Promotor;
        const isIdentical =
          Boolean(localProm) &&
          localProm!.nome === nextProm.nome &&
          (localProm!.agenciaId || null) === (nextProm.agenciaId || null) &&
          (localProm!.agenciaNome || '') === (nextProm.agenciaNome || '') &&
          localProm!.status === nextProm.status &&
          (localProm!.atualizadoEm || '') === (nextProm.atualizadoEm || '') &&
          JSON.stringify(localProm!.setores || []) === JSON.stringify(nextProm.setores || []) &&
          (localProm!.dispositivoVinculado?.dispositivoId || null) ===
            (nextProm.dispositivoVinculado?.dispositivoId || null);

        if (!isIdentical) {
          mapProm.set(id, nextProm);
          promChanged = true;
          aplicadosCount += 1;
        }
      }

      // Aplicar vínculos promotor x agência se mais recentes que o registro atual do promotor
      for (const rawVa of remote.rawVinculosAg) {
        if (!rawVa || !rawVa.promotorId) continue;
        const pId = String(rawVa.promotorId);
        const prom = mapProm.get(pId);
        if (!prom) continue;
        const vaKey = `vinculosPromotorAgencia:${rawVa.id || `pa_${pId}_172`}`;
        if (lockedKeys.has(`promotores:${pId}`) || lockedKeys.has(vaKey)) {
          const promTs = extractTimestampMs(prom);
          const vaTs = extractTimestampMs(rawVa);
          if (vaTs <= promTs) continue;
        }
        const promTs = extractTimestampMs(prom);
        const vaTs = extractTimestampMs(rawVa);
        if (vaTs > promTs) {
          const desvinculado = rawVa.ativo === false || isAgenciaSemVinculoNome(rawVa.agenciaNome);
          const nextAgId = desvinculado ? null : (rawVa.agenciaId || gerarAgenciaId(rawVa.agenciaNome));
          const nextAgNome = desvinculado ? '' : String(rawVa.agenciaNome || '');
          if (
            (prom.agenciaId || null) !== (nextAgId || null) ||
            (prom.agenciaNome || '') !== nextAgNome
          ) {
            mapProm.set(pId, {
              ...prom,
              agenciaId: nextAgId,
              agenciaNome: nextAgNome,
              atualizadoEm: rawVa.atualizadoEm || prom.atualizadoEm,
            });
            promChanged = true;
            aplicadosCount += 1;
          }
        }
      }

      // Remover promotor seed MARIA default caso a nuvem já tenha outros promotores reais e MARIA local nunca foi editada
      if (
        remote.rawPromotores.length > 0 &&
        mapProm.size > 1 &&
        mapProm.has('promotor_maria_seara_172') &&
        !remote.rawPromotores.some((r) => r.promotorId === 'promotor_maria_seara_172')
      ) {
        const mariaLocal = mapProm.get('promotor_maria_seara_172');
        if (
          mariaLocal &&
          mariaLocal.criadoPor === 'SISTEMA_PRINCIPAL' &&
          mariaLocal.atualizadoPor === 'SISTEMA_PRINCIPAL' &&
          !mariaLocal.atualizadoEm &&
          !lockedKeys.has('promotores:promotor_maria_seara_172')
        ) {
          mapProm.delete('promotor_maria_seara_172');
          promChanged = true;
        }
      }

      if (promChanged) {
        nextPromotores = Array.from(mapProm.values());
        hasAnyChange = true;
      }
    }

    // 3. Vínculos Promotor × Indústria (com suporte a tombstone `ativo: false` e deduplicação)
    let nextVinculosIndustria: VinculoPromotorIndustria[] | undefined;
    if (remote.rawVinculosInd.length > 0) {
      const mapVinc = new Map<string, VinculoPromotorIndustria>();
      for (const v of local.vinculosIndustria) {
        mapVinc.set(v.id, v);
      }

      let vincChanged = false;
      for (const raw of remote.rawVinculosInd) {
        const parsed = fromFirestoreVinculoIndustria(raw);
        if (!parsed) continue;
        const key = `vinculos_promotor_industria:${parsed.id}`;
        const localVinc = mapVinc.get(parsed.id);
        const tombstoneIso = this._state.tombstonesVinculosIndustria[parsed.id];
        const tombstoneMs = tombstoneIso ? Date.parse(tombstoneIso) : 0;
        const remoteTs = extractTimestampMs(raw);
        const localTs = Math.max(extractTimestampMs(localVinc), tombstoneMs || 0);

        if (lockedKeys.has(key) && remoteTs <= localTs) continue;
        if (localTs > remoteTs) continue;

        if (raw.ativo === false) {
          if (localVinc) {
            mapVinc.delete(parsed.id);
            vincChanged = true;
            aplicadosCount += 1;
          }
          this._state.tombstonesVinculosIndustria[parsed.id] =
            String(raw.atualizadoEm || new Date().toISOString());
        } else {
          // Garantir que não existe duplicidade por (promotorId + cnpj)
          let dedupRemoved = false;
          for (const [kExist, vExist] of mapVinc.entries()) {
            if (vExist.promotorId === parsed.promotorId && vExist.cnpj === parsed.cnpj && kExist !== parsed.id) {
              mapVinc.delete(kExist);
              dedupRemoved = true;
            }
          }
          delete this._state.tombstonesVinculosIndustria[parsed.id];

          const isIdentical =
            !dedupRemoved &&
            Boolean(localVinc) &&
            localVinc!.promotorId === parsed.promotorId &&
            localVinc!.cnpj === parsed.cnpj &&
            (localVinc!.promotorNome || '') === (parsed.promotorNome || '') &&
            (localVinc!.agenciaNome || '') === (parsed.agenciaNome || '') &&
            (localVinc!.atualizadoEm || '') === (parsed.atualizadoEm || '');

          if (!isIdentical) {
            mapVinc.set(parsed.id, parsed);
            vincChanged = true;
            aplicadosCount += 1;
          }
        }
      }

      if (vincChanged) {
        nextVinculosIndustria = Array.from(mapVinc.values());
        hasAnyChange = true;
      }
    }

    // 4. Vínculos Dispositivo × Promotor (somente Gerência autenticada)
    let nextVinculosDispositivo: VinculoPromotor[] | undefined;
    if (remote.rawVinculosDisp.length > 0) {
      const mapDisp = new Map<string, VinculoPromotor>();
      for (const v of local.vinculosDispositivo) {
        mapDisp.set(v.vinculoId, v);
      }

      let dispChanged = false;
      for (const raw of remote.rawVinculosDisp) {
        if (!raw || !raw.vinculoId) continue;
        const id = String(raw.vinculoId);
        const localV = mapDisp.get(id);
        const isLocked = lockedKeys.has(`vinculosPromotor:${id}`);
        const remoteTs = extractTimestampMs(raw);
        const localTs = extractTimestampMs(localV);

        if (localV && isLocked && remoteTs <= localTs) continue;
        if (localV && localTs > remoteTs) continue;

        const nextV = raw as VinculoPromotor;
        const isIdentical =
          Boolean(localV) &&
          localV!.status === nextV.status &&
          (localV!.dispositivoId || null) === (nextV.dispositivoId || null) &&
          (localV!.atualizadoEm || '') === (nextV.atualizadoEm || '');

        if (!isIdentical) {
          mapDisp.set(id, nextV);
          dispChanged = true;
          aplicadosCount += 1;
        }
      }

      if (dispChanged) {
        nextVinculosDispositivo = Array.from(mapDisp.values());
        hasAnyChange = true;
      }
    }

    // 5. Histórico de Movimentações Comerciais (append-only sem duplicatas)
    let nextMovimentacoes: HistoricoMovimentacaoComercial[] | undefined;
    if (remote.rawMovs.length > 0) {
      const mapMov = new Map<string, HistoricoMovimentacaoComercial>();
      for (const m of local.historicoMovimentacoes) {
        if (m && m.id) mapMov.set(m.id, m);
      }

      let movChanged = false;
      for (const raw of remote.rawMovs) {
        if (!raw || !raw.id) continue;
        const id = String(raw.id);
        if (!mapMov.has(id)) {
          mapMov.set(id, raw as HistoricoMovimentacaoComercial);
          movChanged = true;
          aplicadosCount += 1;
        }
      }

      if (movChanged) {
        nextMovimentacoes = Array.from(mapMov.values())
          .sort((a, b) => (b.dataHora || '').localeCompare(a.dataHora || ''))
          .slice(0, 500);
        hasAnyChange = true;
      }
    }

    return {
      hasAnyChange,
      aplicadosCount,
      nextPromotores,
      nextAgencias,
      nextVinculosIndustria,
      nextVinculosDispositivo,
      nextMovimentacoes,
    };
  }

  /**
   * Reconciliação bidirecional incremental: compara o IndexedDB local com o Firestore,
   * enfileirando exclusivamente registros/vínculos locais ausentes ou estritamente mais novos
   * na nuvem, sem duplicar nem excluir dados existentes.
   */
  private async _reconciliarDadosLocaisVsNuvem(
    local: ComercialLocalStateSnapshot,
    remote: {
      rawPromotores: Array<Record<string, any>>;
      rawAgencias: Array<Record<string, any>>;
      rawVinculosInd: Array<Record<string, any>>;
      rawVinculosAg: Array<Record<string, any>>;
      rawMovs: Array<Record<string, any>>;
      rawVinculosDisp: Array<Record<string, any>>;
    },
    options?: { includeDispositivos?: boolean }
  ): Promise<void> {
    const locked = this._getLockedEntityKeys();
    const ops: ComercialWriteOp[] = [];
    const entityKeys: string[] = [];
    const pointerDomains: ComercialSyncDomain[] = [];
    const usuario = this._adapter.getUsuarioAtual();

    const remotePromMap = new Map(remote.rawPromotores.map((r) => [String(r.promotorId), r]));
    const remoteAgMap = new Map(remote.rawAgencias.map((r) => [String(r.agenciaId), r]));
    const remoteVincIndMap = new Map(
      remote.rawVinculosInd.map((r) => [String(r.id || r.vinculoId), r])
    );
    const remoteVincAgMap = new Map(
      remote.rawVinculosAg.map((r) => [String(r.id || r.vinculoId || `pa_${r.promotorId}_${FILIAL_COMERCIAL_ID}`), r])
    );
    const remoteMovIds = new Set(remote.rawMovs.map((r) => String(r.id)));
    const remoteDispMap = new Map(remote.rawVinculosDisp.map((r) => [String(r.vinculoId), r]));

    for (const ag of local.agencias) {
      if (locked.has(`agencias:${ag.agenciaId}`)) continue;
      const rem = remoteAgMap.get(ag.agenciaId);
      if (!rem || extractTimestampMs(ag) > extractTimestampMs(rem)) {
        ops.push({
          collectionName: 'agencias',
          docId: ag.agenciaId,
          payload: buildFirestoreAgenciaPayload(ag),
          merge: true,
        });
        entityKeys.push(`agencias:${ag.agenciaId}`);
        pointerDomains.push('agencias');
      }
    }

    for (const p of local.promotores) {
      const isUntouchedSeedMaria =
        p.promotorId === 'promotor_maria_seara_172' &&
        remote.rawPromotores.length > 0 &&
        !p.atualizadoEm;
      if (isUntouchedSeedMaria) {
        continue;
      }

      const rem = remotePromMap.get(p.promotorId);
      if (!locked.has(`promotores:${p.promotorId}`)) {
        if (!rem || extractTimestampMs(p) > extractTimestampMs(rem)) {
          ops.push({
            collectionName: 'promotores',
            docId: p.promotorId,
            payload: buildFirestorePromotorPayload(p),
            merge: true,
          });
          entityKeys.push(`promotores:${p.promotorId}`);
          pointerDomains.push('promotores');
        }
      }

      // Verificar vínculo promotor × agência de forma independente (mesmo quando promotor já está na nuvem)
      const va = buildFirestoreVinculoAgenciaPayload(
        p,
        p.atualizadoEm || p.dataCadastro || new Date().toISOString(),
        usuario
      );
      if (!locked.has(`vinculosPromotorAgencia:${va.id}`)) {
        const remVa = remoteVincAgMap.get(va.id);
        if (!remVa || extractTimestampMs(p) > extractTimestampMs(remVa)) {
          ops.push({
            collectionName: 'vinculosPromotorAgencia',
            docId: va.id,
            payload: va,
            merge: true,
          });
          entityKeys.push(`vinculosPromotorAgencia:${va.id}`);
          pointerDomains.push('vinculosPromotorAgencia');
        }
      }
    }

    const industriaMap = new Map(
      local.industrias.map((i) => [normalizarCnpj(i.cnpj), i.razao_social || i.nome_exibicao])
    );

    for (const v of local.vinculosIndustria) {
      if (locked.has(`vinculos_promotor_industria:${v.id}`)) continue;
      const rem = remoteVincIndMap.get(v.id);
      if (!rem || extractTimestampMs(v) > extractTimestampMs(rem)) {
        ops.push({
          collectionName: 'vinculos_promotor_industria',
          docId: v.id,
          payload: buildFirestoreVinculoIndustriaPayload(v, {
            ativo: true,
            usuario,
            industriaRazaoSocial: industriaMap.get(normalizarCnpj(v.cnpj)),
          }),
          merge: true,
        });
        entityKeys.push(`vinculos_promotor_industria:${v.id}`);
        pointerDomains.push('vinculos_promotor_industria');
      }
    }

    if (options?.includeDispositivos !== false) {
      for (const vd of local.vinculosDispositivo) {
        if (locked.has(`vinculosPromotor:${vd.vinculoId}`)) continue;
        const rem = remoteDispMap.get(vd.vinculoId);
        if (!rem || extractTimestampMs(vd) > extractTimestampMs(rem)) {
          const vp = buildFirestoreVinculoDispositivoPayload(vd);
          ops.push(
            { collectionName: 'vinculosPromotor', docId: vd.vinculoId, payload: vp, merge: true },
            { collectionName: 'vinculos_promotores', docId: vd.vinculoId, payload: vp, merge: true }
          );
          entityKeys.push(`vinculosPromotor:${vd.vinculoId}`);
          pointerDomains.push('vinculos_dispositivo');
        }
      }
    }

    for (const mov of local.historicoMovimentacoes) {
      if (!mov?.id || locked.has(`movimentacoes_comerciais:${mov.id}`)) continue;
      if (!remoteMovIds.has(mov.id)) {
        ops.push({
          collectionName: 'movimentacoes_comerciais',
          docId: mov.id,
          payload: buildFirestoreMovimentacaoPayload(mov),
          merge: false,
          immutableCreate: true,
        });
        entityKeys.push(`movimentacoes_comerciais:${mov.id}`);
        pointerDomains.push('movimentacoes_comerciais');
      }
    }

    if (ops.length > 0) {
      // Dividir em lotes seguros (<=150 ops) para nunca exceder o limite de 500 ops/batch do Firestore
      const MAX_OPS_POR_LOTE = 150;
      for (let i = 0; i < ops.length; i += MAX_OPS_POR_LOTE) {
        const chunkOps = ops.slice(i, i + MAX_OPS_POR_LOTE);
        const chunkKeys = new Set<string>();
        const chunkDomains = new Set<ComercialSyncDomain>();
        for (const op of chunkOps) {
          if (op.collectionName === 'agencias') {
            chunkKeys.add(`agencias:${op.docId}`);
            chunkDomains.add('agencias');
          } else if (op.collectionName === 'promotores') {
            chunkKeys.add(`promotores:${op.docId}`);
            chunkDomains.add('promotores');
          } else if (op.collectionName === 'vinculosPromotorAgencia') {
            chunkKeys.add(`vinculosPromotorAgencia:${op.docId}`);
            chunkDomains.add('vinculosPromotorAgencia');
          } else if (op.collectionName === 'vinculos_promotor_industria') {
            chunkKeys.add(`vinculos_promotor_industria:${op.docId}`);
            chunkDomains.add('vinculos_promotor_industria');
          } else if (
            op.collectionName === 'vinculosPromotor' ||
            op.collectionName === 'vinculos_promotores'
          ) {
            chunkKeys.add(`vinculosPromotor:${op.docId}`);
            chunkDomains.add('vinculos_dispositivo');
          } else if (op.collectionName === 'movimentacoes_comerciais') {
            chunkKeys.add(`movimentacoes_comerciais:${op.docId}`);
            chunkDomains.add('movimentacoes_comerciais');
          }
        }
        await this.enqueueOperations({
          domain: 'batch_substituicao',
          entityKeys: Array.from(chunkKeys),
          pointerDomains: Array.from(chunkDomains),
          operations: chunkOps,
          flushImmediately: false,
        });
      }
    }
  }
}

export const comercialSyncService = new ComercialSyncService();
