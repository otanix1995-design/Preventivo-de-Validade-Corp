/**
 * NUVEM V3 — GUARDA DE PUBLICAÇÃO, TIMEOUT, CONCORRÊNCIA E INTEGRIDADE NO FIRESTORE
 *
 * Centraliza para as três bases (BASE RUB, SPCOI007 e SAEOU060):
 * 1. Controle de concorrência limitada (padrão: até 2 chunks simultâneos).
 * 2. Controle explícito de tempo limite sem acumular retentativas enquanto uma
 *    gravação anterior do SDK Firebase permanecer pendente em segundo plano.
 * 3. Verificação do estado remoto antes de iniciar qualquer nova tentativa.
 * 4. Validação integral de chunks, metadados e checksum no servidor antes de comutar
 *    o ponteiro de versão ativa.
 * 5. Confirmação pós-transação do ponteiro ativo no servidor antes de reportar 100%.
 */

import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocFromServer,
  getDocs,
  runTransaction,
  setDoc,
  Firestore,
} from 'firebase/firestore';
import {
  db as defaultDb,
  ensureAuth as defaultEnsureAuth,
  isFirestoreQuotaExceeded as defaultIsFirestoreQuotaExceeded,
  isQuotaError as defaultIsQuotaError,
  markQuotaExceeded as defaultMarkQuotaExceeded,
  QuotaLockState,
  QuotaResourceType,
  subscribeQuotaStatus as defaultSubscribeQuotaStatus,
} from './firebase';

export type StatusSyncBase =
  | 'LOCAL'
  | 'PUBLICANDO'
  | 'SINCRONIZADO'
  | 'PENDENTE_CONFIRMACAO'
  | 'BLOQUEADO_COTA'
  | 'ERRO';

export type EstadoPublicacaoResultado =
  | 'CONFIRMADA'
  | 'LOCAL_SEM_NUVEM'
  | 'PENDENTE_CONFIRMACAO'
  | 'AGUARDANDO_COTA'
  | 'RECUSADA_PERMISSAO'
  | 'ERRO';

export interface ResultadoPublicacaoBase {
  sucesso: boolean;
  estadoPublicacao: EstadoPublicacaoResultado;
  versaoConfirmadaNoServidor: boolean;
  mensagem: string;
  versaoId?: string;
  motivoRecusa?: string;
  chunksEnviados?: number;
  totalChunks?: number;
  chunkFalhou?: number;
  aguardandoCota?: boolean;
  semAlteracoesPulouEnvio?: boolean;
}

export const DEFAULT_CONCURRENCY_LIMIT = 2;
export const DEFAULT_WRITE_TIMEOUT_MS = 25_000;
export const DEFAULT_READ_TIMEOUT_MS = 15_000;
export const MAX_FIRESTORE_DOC_UTF8_BYTES = 900 * 1024;

export class PublishTimeoutError extends Error {
  public readonly chunkIndex?: number;
  public readonly etapa: string;
  public readonly timeoutMs: number;

  constructor(etapa: string, timeoutMs: number, chunkIndex?: number) {
    const chunkInfo = chunkIndex !== undefined ? ` (chunk_${chunkIndex})` : '';
    super(
      `Tempo limite de ${Math.round(timeoutMs / 1000)}s excedido durante "${etapa}"${chunkInfo}. A confirmação da nuvem permanece pendente.`
    );
    this.name = 'PublishTimeoutError';
    this.etapa = etapa;
    this.timeoutMs = timeoutMs;
    this.chunkIndex = chunkIndex;
  }
}

export class PublishIntegrityError extends Error {
  public readonly versaoId: string;

  constructor(versaoId: string, mensagem: string) {
    super(mensagem);
    this.name = 'PublishIntegrityError';
    this.versaoId = versaoId;
  }
}

export interface PendingVersionRecord {
  versaoId: string;
  chunkFalhou?: number;
  motivo: string;
  registradoEmMs: number;
}

/**
 * Rastreia promessas internas de gravação no SDK do Firestore.
 * Como Promise.race com timeout NÃO cancela a gravação interna do Firebase,
 * este rastreador impede que novas tentativas acumulem escritas concorrentes
 * enquanto operações anteriores ainda não se encerraram.
 */
export class PendingWriteTracker {
  private _inFlight: Set<Promise<unknown>> = new Set();
  private _pendingVersion: PendingVersionRecord | null = null;

  public track<T>(promise: Promise<T>): Promise<T> {
    this._inFlight.add(promise);
    promise.then(
      () => {
        this._inFlight.delete(promise);
      },
      () => {
        this._inFlight.delete(promise);
      }
    );
    return promise;
  }

  public hasUnsettledWrites(): boolean {
    return this._inFlight.size > 0;
  }

  public getPendingCount(): number {
    return this._inFlight.size;
  }

  public setPendingVersion(record: PendingVersionRecord | null): void {
    this._pendingVersion = record;
  }

  public getPendingVersion(): PendingVersionRecord | null {
    return this._pendingVersion ? { ...this._pendingVersion } : null;
  }

  public clearAllForTest(): void {
    this._inFlight.clear();
    this._pendingVersion = null;
  }
}

export interface PublishAdapter {
  db: Firestore | null;
  ensureAuth: () => Promise<unknown>;
  isFirestoreQuotaExceeded: () => boolean;
  markQuotaExceeded: (motivo?: string, recurso?: QuotaResourceType) => void;
  isQuotaError: (err: unknown) => boolean;
  subscribeQuotaStatus?: (listener: (state: QuotaLockState) => void) => () => void;
  doc: (db: Firestore, ...pathSegments: string[]) => any;
  collection: (db: Firestore, ...pathSegments: string[]) => any;
  setDoc: (ref: any, data: any) => Promise<void>;
  getDoc: (ref: any) => Promise<any>;
  getDocFromServer: (ref: any) => Promise<any>;
  getDocs: (ref: any) => Promise<any>;
  getCountFromServer: (ref: any) => Promise<{ data: () => { count: number } }>;
  runTransaction: <T>(db: Firestore, fn: (txn: any) => Promise<T>) => Promise<T>;
}

export function createDefaultPublishAdapter(): PublishAdapter {
  return {
    db: defaultDb,
    ensureAuth: defaultEnsureAuth,
    isFirestoreQuotaExceeded: defaultIsFirestoreQuotaExceeded,
    markQuotaExceeded: defaultMarkQuotaExceeded,
    isQuotaError: defaultIsQuotaError,
    subscribeQuotaStatus: defaultSubscribeQuotaStatus,
    doc: (firestore, ...segments) => doc(firestore, segments[0], ...segments.slice(1)),
    collection: (firestore, ...segments) => collection(firestore, segments[0], ...segments.slice(1)),
    setDoc: (ref, data) => setDoc(ref, data),
    getDoc: (ref) => getDoc(ref),
    getDocFromServer: (ref) => getDocFromServer(ref),
    getDocs: (ref) => getDocs(ref),
    getCountFromServer: (ref) => getCountFromServer(ref),
    runTransaction: (firestore, fn) => runTransaction(firestore, fn),
  };
}

export async function runTrackedWithTimeout<T>(
  tracker: PendingWriteTracker,
  fn: () => Promise<T>,
  timeoutMs: number,
  etapa: string,
  chunkIndex?: number
): Promise<T> {
  const opPromise = tracker.track(fn());
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new PublishTimeoutError(etapa, timeoutMs, chunkIndex));
    }, timeoutMs);
  });

  try {
    return await Promise.race([opPromise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function runReadWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  etapa: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new PublishTimeoutError(etapa, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Lê um documento diretamente do servidor sempre que suportado pelo adaptador,
 * garantindo que caches locais não mascaram o estado real do Firestore.
 */
export async function readDocFromServerWithTimeout(
  adapter: PublishAdapter,
  docRef: any,
  timeoutMs: number,
  etapa: string
): Promise<any> {
  return runReadWithTimeout(async () => {
    if (typeof adapter.getDocFromServer === 'function') {
      try {
        return await adapter.getDocFromServer(docRef);
      } catch (err: any) {
        const msg = String(err?.message || '').toLowerCase();
        // Caso o ambiente de mock/testes não implemente getDocFromServer, faz fallback controlado para getDoc
        if (msg.includes('not implemented') || msg.includes('not a function')) {
          return await adapter.getDoc(docRef);
        }
        throw err;
      }
    }
    return await adapter.getDoc(docRef);
  }, timeoutMs, etapa);
}

/**
 * Conta documentos de uma subcoleção no servidor com timeout explícito.
 */
export async function countCollectionFromServerWithTimeout(
  adapter: PublishAdapter,
  colRef: any,
  timeoutMs: number,
  etapa: string
): Promise<number> {
  return runReadWithTimeout(async () => {
    if (typeof adapter.getCountFromServer === 'function') {
      const countSnap = await adapter.getCountFromServer(colRef);
      return Number(countSnap.data().count || 0);
    }
    const docsSnap = await adapter.getDocs(colRef);
    return Number(docsSnap.size || 0);
  }, timeoutMs, etapa);
}

export function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length * 2;
}

export async function calcularChecksumSha256(conteudo: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const msgUint8 = new TextEncoder().encode(conteudo);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback abaixo
    }
  }
  let hash1 = 5381;
  let hash2 = 52711;
  for (let i = 0; i < conteudo.length; i++) {
    const char = conteudo.charCodeAt(i);
    hash1 = (hash1 * 33) ^ char;
    hash2 = (hash2 * 33) ^ char;
  }
  return `CHK_${Math.abs(hash1).toString(16)}_${Math.abs(hash2).toString(16)}_${conteudo.length}`;
}

/**
 * Divide registros em chunks seguros abaixo do limite de 1 MiB do Firestore,
 * respeitando um teto alvo (ex.: 400 KB ou 450 KB) usando tamanho UTF-8 real.
 */
export function buildSafeChunks<T>(items: T[], maxChunkBytes: number): T[][] {
  const safeLimit = Math.min(maxChunkBytes, MAX_FIRESTORE_DOC_UTF8_BYTES);
  const chunks: T[][] = [];
  let currentChunk: T[] = [];
  let currentChunkBytes = 0;

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const itemBytes = utf8ByteLength(JSON.stringify(item)) + 4;

    if (itemBytes > MAX_FIRESTORE_DOC_UTF8_BYTES) {
      throw new Error(
        `Registro #${idx + 1} excede o limite máximo seguro de documento do Firestore (${Math.round(itemBytes / 1024)} KB).`
      );
    }

    if (currentChunkBytes + itemBytes > safeLimit && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [item];
      currentChunkBytes = itemBytes;
    } else {
      currentChunk.push(item);
      currentChunkBytes += itemBytes;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export interface VerificacaoPrePublicacao<TConfig> {
  podeIniciar: boolean;
  versaoAtivaServidor: TConfig | null;
  mensagem?: string;
  estadoPublicacao?: EstadoPublicacaoResultado;
  chunkFalhou?: number;
}

/**
 * Antes de iniciar qualquer nova tentativa de publicação:
 * 1. Bloqueia se gravações da tentativa anterior ainda não encerraram no SDK.
 * 2. Se houve uma versão pendente anterior (timeout), consulta seu estado no servidor.
 * 3. Lê o ponteiro oficial atualizado diretamente do servidor.
 */
export async function verificarEstadoRemotoAntesDePublicar<TConfig extends { versaoId?: string }>(
  adapter: PublishAdapter,
  tracker: PendingWriteTracker,
  filialId: string,
  configDocId: string,
  versoesCollectionName: string,
  readTimeoutMs: number
): Promise<VerificacaoPrePublicacao<TConfig>> {
  if (!adapter.db) {
    return {
      podeIniciar: false,
      versaoAtivaServidor: null,
      mensagem: 'Banco Firestore central indisponível.',
      estadoPublicacao: 'ERRO',
    };
  }

  // Nunca acumular novas escritas enquanto promessas anteriores ainda estão pendentes no SDK
  if (tracker.hasUnsettledWrites()) {
    const pending = tracker.getPendingVersion();
    return {
      podeIniciar: false,
      versaoAtivaServidor: null,
      estadoPublicacao: 'PENDENTE_CONFIRMACAO',
      chunkFalhou: pending?.chunkFalhou,
      mensagem:
        `Existem ${tracker.getPendingCount()} gravação(ões) da tentativa anterior aguardando resposta do Firebase` +
        (pending?.chunkFalhou !== undefined ? ` (chunk_${pending.chunkFalhou})` : '') +
        '. Aguarde a estabilização da rede antes de iniciar nova publicação para evitar acúmulo na fila.',
    };
  }

  const configRef = adapter.doc(adapter.db, 'filiais', filialId, 'config', configDocId);
  const configSnap = await readDocFromServerWithTimeout(
    adapter,
    configRef,
    readTimeoutMs,
    'verificação prévia da versão ativa no servidor'
  );

  let versaoAtivaServidor: TConfig | null = null;
  if (configSnap.exists()) {
    const raw = configSnap.data() as TConfig & { ativa?: boolean; status?: string };
    if (raw.versaoId && raw.ativa !== false && raw.status !== 'LIMPA_AGUARDANDO_IMPORTACAO') {
      versaoAtivaServidor = raw;
    }
  }

  // Se houve uma tentativa anterior que sofreu timeout e já encerrou no SDK, inspecionar seu estado no servidor
  const pendingVersion = tracker.getPendingVersion();
  if (pendingVersion) {
    try {
      const pendingMetaRef = adapter.doc(
        adapter.db,
        'filiais',
        filialId,
        versoesCollectionName,
        pendingVersion.versaoId
      );
      const pendingMetaSnap = await readDocFromServerWithTimeout(
        adapter,
        pendingMetaRef,
        readTimeoutMs,
        'inspeção de versão pendente anterior'
      );

      if (pendingMetaSnap.exists()) {
        console.info(
          `[FirestorePublishGuard] Versão pendente anterior ${pendingVersion.versaoId} encontrada no servidor (não ativada: ${versaoAtivaServidor?.versaoId !== pendingVersion.versaoId}).`
        );
      } else {
        console.info(
          `[FirestorePublishGuard] Versão pendente anterior ${pendingVersion.versaoId} não concluiu metadados no servidor. Ponteiro ativo preservado: ${versaoAtivaServidor?.versaoId || 'nenhum'}.`
        );
      }
      tracker.setPendingVersion(null);
    } catch (inspectErr) {
      // Se não conseguimos sequer consultar o servidor, não iniciar nova publicação cega
      return {
        podeIniciar: false,
        versaoAtivaServidor,
        estadoPublicacao: 'PENDENTE_CONFIRMACAO',
        chunkFalhou: pendingVersion.chunkFalhou,
        mensagem:
          'Não foi possível verificar no servidor o estado da publicação pendente anterior. Verifique a conexão antes de tentar novamente.',
      };
    }
  }

  return {
    podeIniciar: true,
    versaoAtivaServidor,
  };
}

export interface ChunkUploadParams<TChunk> {
  adapter: PublishAdapter;
  tracker: PendingWriteTracker;
  filialId: string;
  versoesCollectionName: string;
  versaoId: string;
  chunks: TChunk[];
  buildPayload: (chunkData: TChunk, chunkIdx: number, totalChunks: number) => Record<string, any>;
  concurrencyLimit?: number;
  writeTimeoutMs?: number;
  onChunkBatchConfirmed?: (chunksConfirmados: number, totalChunks: number) => void;
}

export interface ChunkUploadResult {
  confirmedIndices: Set<number>;
  totalChunks: number;
}

/**
 * Envia chunks com concorrência limitada (padrão 2), sem retentativas em paralelo
 * caso algum chunk exceda o timeout ou falhe.
 */
export async function executarEnvioChunksControlado<TChunk>(
  params: ChunkUploadParams<TChunk>
): Promise<ChunkUploadResult> {
  const {
    adapter,
    tracker,
    filialId,
    versoesCollectionName,
    versaoId,
    chunks,
    buildPayload,
    concurrencyLimit = DEFAULT_CONCURRENCY_LIMIT,
    writeTimeoutMs = DEFAULT_WRITE_TIMEOUT_MS,
    onChunkBatchConfirmed,
  } = params;

  if (!adapter.db) {
    throw new Error('Banco Firestore central indisponível.');
  }

  const limit = Math.max(1, Math.min(concurrencyLimit, DEFAULT_CONCURRENCY_LIMIT));
  const confirmedIndices = new Set<number>();

  for (let i = 0; i < chunks.length; i += limit) {
    const batch = chunks.slice(i, i + limit);

    await Promise.all(
      batch.map(async (chunkData, idxInBatch) => {
        const chunkIdx = i + idxInBatch;
        const payload = buildPayload(chunkData, chunkIdx, chunks.length);
        const payloadBytes = utf8ByteLength(JSON.stringify(payload));
        if (payloadBytes > MAX_FIRESTORE_DOC_UTF8_BYTES) {
          throw new Error(
            `Chunk chunk_${chunkIdx} excedeu o limite seguro do Firestore (${Math.round(payloadBytes / 1024)} KB).`
          );
        }

        const chunkDocRef = adapter.doc(
          adapter.db!,
          'filiais',
          filialId,
          versoesCollectionName,
          versaoId,
          'chunks',
          `chunk_${chunkIdx}`
        );

        await runTrackedWithTimeout(
          tracker,
          () => adapter.setDoc(chunkDocRef, payload),
          writeTimeoutMs,
          'envio de partes para a nuvem',
          chunkIdx
        );

        confirmedIndices.add(chunkIdx);
      })
    );

    onChunkBatchConfirmed?.(confirmedIndices.size, chunks.length);
    await new Promise((r) => setTimeout(r, 15));
  }

  return {
    confirmedIndices,
    totalChunks: chunks.length,
  };
}

export interface IntegrityValidationParams {
  adapter: PublishAdapter;
  filialId: string;
  versoesCollectionName: string;
  versaoId: string;
  expectedTotalChunks: number;
  expectedChecksum: string;
  confirmedIndices: Set<number>;
  expectedCountField: string;
  expectedCountValue: number;
  readTimeoutMs?: number;
}

/**
 * Valida no servidor que:
 * 1. Todos os índices 0..N-1 foram confirmados localmente.
 * 2. O documento de metadados da versão existe no servidor com checksumBase e totalChunks corretos.
 * 3. A contagem real de documentos na subcoleção /chunks no servidor equivale a expectedTotalChunks.
 * 4. Os chunks de fronteira (chunk_0 e chunk_{N-1}) existem no servidor com o mesmo versaoId.
 */
export async function validarIntegridadeVersaoNoServidor(
  params: IntegrityValidationParams
): Promise<void> {
  const {
    adapter,
    filialId,
    versoesCollectionName,
    versaoId,
    expectedTotalChunks,
    expectedChecksum,
    confirmedIndices,
    expectedCountField,
    expectedCountValue,
    readTimeoutMs = DEFAULT_READ_TIMEOUT_MS,
  } = params;

  if (!adapter.db) {
    throw new PublishIntegrityError(versaoId, 'Banco Firestore indisponível durante validação de integridade.');
  }

  // 1. Confirmar localmente todos os índices 0..N-1
  if (confirmedIndices.size !== expectedTotalChunks) {
    throw new PublishIntegrityError(
      versaoId,
      `Validação local incompleta: apenas ${confirmedIndices.size} de ${expectedTotalChunks} chunks confirmados.`
    );
  }
  for (let idx = 0; idx < expectedTotalChunks; idx++) {
    if (!confirmedIndices.has(idx)) {
      throw new PublishIntegrityError(
        versaoId,
        `Validação falhou: chunk_${idx} ausente na confirmação do envio.`
      );
    }
  }

  // 2. Validar documento de metadados da versão diretamente no servidor
  const metaRef = adapter.doc(adapter.db, 'filiais', filialId, versoesCollectionName, versaoId);
  const metaSnap = await readDocFromServerWithTimeout(
    adapter,
    metaRef,
    readTimeoutMs,
    'validação de metadados da versão no servidor'
  );

  if (!metaSnap.exists()) {
    throw new PublishIntegrityError(
      versaoId,
      `Metadados da versão ${versaoId} não encontrados no servidor antes da ativação.`
    );
  }

  const metaData = metaSnap.data() || {};
  if (
    metaData.versaoId !== versaoId ||
    metaData.totalChunks !== expectedTotalChunks ||
    metaData.checksumBase !== expectedChecksum ||
    metaData[expectedCountField] !== expectedCountValue
  ) {
    throw new PublishIntegrityError(
      versaoId,
      `Metadados/checksum da versão ${versaoId} divergem do esperado no servidor. Ativação bloqueada.`
    );
  }

  // 3. Validar contagem real dos chunks na subcoleção no servidor
  const chunksColRef = adapter.collection(
    adapter.db,
    'filiais',
    filialId,
    versoesCollectionName,
    versaoId,
    'chunks'
  );
  const serverChunkCount = await countCollectionFromServerWithTimeout(
    adapter,
    chunksColRef,
    readTimeoutMs,
    'contagem de chunks no servidor'
  );

  if (serverChunkCount !== expectedTotalChunks) {
    throw new PublishIntegrityError(
      versaoId,
      `Integridade de chunks reprovada no servidor: encontrados ${serverChunkCount} de ${expectedTotalChunks} chunks. O ponteiro ativo anterior foi preservado.`
    );
  }

  // 4. Validar chunks de fronteira (primeiro e último) no servidor
  const indicesFronteira = expectedTotalChunks > 1 ? [0, expectedTotalChunks - 1] : [0];
  for (const idx of indicesFronteira) {
    const chunkRef = adapter.doc(
      adapter.db,
      'filiais',
      filialId,
      versoesCollectionName,
      versaoId,
      'chunks',
      `chunk_${idx}`
    );
    const chunkSnap = await readDocFromServerWithTimeout(
      adapter,
      chunkRef,
      readTimeoutMs,
      `verificação do chunk_${idx} no servidor`
    );
    if (!chunkSnap.exists()) {
      throw new PublishIntegrityError(
        versaoId,
        `Chunk obrigatório chunk_${idx} não localizado no servidor para a versão ${versaoId}.`
      );
    }
    const cData = chunkSnap.data() || {};
    if (cData.versaoId !== versaoId || cData.totalChunks !== expectedTotalChunks) {
      throw new PublishIntegrityError(
        versaoId,
        `Chunk chunk_${idx} possui metadados inconsistentes para a versão ${versaoId}.`
      );
    }
  }
}

/**
 * Confirma diretamente no servidor que o ponteiro oficial aponta para a versão recém-publicada.
 */
export async function confirmarPonteiroAtivoNoServidor(
  adapter: PublishAdapter,
  filialId: string,
  configDocId: string,
  expectedVersaoId: string,
  expectedChecksum: string,
  expectedTotalChunks: number,
  readTimeoutMs: number = DEFAULT_READ_TIMEOUT_MS
): Promise<void> {
  if (!adapter.db) {
    throw new PublishIntegrityError(expectedVersaoId, 'Banco Firestore indisponível ao confirmar ponteiro ativo.');
  }

  const configRef = adapter.doc(adapter.db, 'filiais', filialId, 'config', configDocId);
  const snap = await readDocFromServerWithTimeout(
    adapter,
    configRef,
    readTimeoutMs,
    'confirmação da versão ativa no servidor'
  );

  if (!snap.exists()) {
    throw new PublishIntegrityError(
      expectedVersaoId,
      `Ponteiro oficial ${configDocId} não encontrado no servidor após transação.`
    );
  }

  const activeData = snap.data() || {};
  if (
    activeData.versaoId !== expectedVersaoId ||
    activeData.checksumBase !== expectedChecksum ||
    activeData.totalChunks !== expectedTotalChunks
  ) {
    throw new PublishIntegrityError(
      expectedVersaoId,
      `O ponteiro ativo no servidor (${activeData.versaoId || 'vazio'}) não corresponde à versão publicada (${expectedVersaoId}).`
    );
  }
}

export interface VerificacaoIdempotenciaParams<TConfig extends Record<string, any>> {
  adapter: PublishAdapter;
  filialId: string;
  versoesCollectionName: string;
  versaoAtivaServidor: TConfig | null;
  expectedChecksum: string;
  expectedTotalChunks: number;
  expectedCountField: string;
  expectedCountValue: number;
  readTimeoutMs?: number;
}

/**
 * Verifica com ZERO escritas se a versão já ativa no servidor possui exatamente
 * os mesmos dados (checksum, totalChunks e contagem) e se seus chunks/metadados
 * estão íntegros no Firestore. Evita reenviar toda a base quando não houve alterações.
 */
export async function verificarVersaoAtivaIdenticaEIntegra<TConfig extends Record<string, any>>(
  params: VerificacaoIdempotenciaParams<TConfig>
): Promise<{ reutilizavel: boolean; versaoId?: string; motivo?: string }> {
  const {
    adapter,
    filialId,
    versoesCollectionName,
    versaoAtivaServidor,
    expectedChecksum,
    expectedTotalChunks,
    expectedCountField,
    expectedCountValue,
    readTimeoutMs = DEFAULT_READ_TIMEOUT_MS,
  } = params;

  if (!versaoAtivaServidor || !versaoAtivaServidor.versaoId) {
    return { reutilizavel: false, motivo: 'Sem versão ativa prévia no servidor.' };
  }

  if (
    versaoAtivaServidor.checksumBase !== expectedChecksum ||
    Number(versaoAtivaServidor.totalChunks || 0) !== expectedTotalChunks
  ) {
    return { reutilizavel: false, motivo: 'Conteúdo alterado em relação à versão ativa.' };
  }

  if (
    versaoAtivaServidor[expectedCountField] !== undefined &&
    Number(versaoAtivaServidor[expectedCountField]) !== expectedCountValue
  ) {
    return { reutilizavel: false, motivo: 'Contagem de registros alterada em relação à versão ativa.' };
  }

  const confirmedIndices = new Set<number>();
  for (let i = 0; i < expectedTotalChunks; i++) {
    confirmedIndices.add(i);
  }

  try {
    await validarIntegridadeVersaoNoServidor({
      adapter,
      filialId,
      versoesCollectionName,
      versaoId: versaoAtivaServidor.versaoId,
      expectedTotalChunks,
      expectedChecksum,
      confirmedIndices,
      expectedCountField,
      expectedCountValue,
      readTimeoutMs,
    });

    return {
      reutilizavel: true,
      versaoId: versaoAtivaServidor.versaoId,
    };
  } catch (err: any) {
    if (err instanceof PublishIntegrityError || err?.name === 'PublishIntegrityError') {
      return {
        reutilizavel: false,
        motivo: err.message,
      };
    }
    // Erros de cota ou timeout devem subir para interromper com segurança sem gravar chunks redundantes
    throw err;
  }
}
