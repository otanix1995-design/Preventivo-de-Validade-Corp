import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import {
  doc,
  Firestore,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

auth = getAuth(app);

// Initialize Firestore with local persistent cache and ignoreUndefinedProperties
try {
  const dbSettings: any = {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  };
  if (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)') {
    db = initializeFirestore(app, dbSettings, firebaseConfig.firestoreDatabaseId);
  } else {
    db = initializeFirestore(app, dbSettings);
  }
} catch {
  // If already initialized in hot-reload or environment doesn't support indexedDb, fallback to getFirestore
  if (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)') {
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  } else {
    db = getFirestore(app);
  }
}

// ============================================================================
// CONTROLE DE COTA DO FIRESTORE & LOGS DE LEITURA (FIREBASE SPARK GRATUITO)
// ============================================================================

const STORAGE_KEY_QUOTA_LEGACY = 'firestore_quota_exceeded_until';
const STORAGE_KEY_QUOTA_LOCK = 'firestore_quota_lock_v2';

export type QuotaResourceType = 'ESCRITA' | 'LEITURA' | 'COTA_DIARIA';

export interface QuotaLockState {
  bloqueado: boolean;
  motivo: string;
  recurso: QuotaResourceType;
  detectadoEmIso: string;
  ultimaVerificacaoEmIso?: string;
  ultimaRespostaServidor?: string;
}

const DEFAULT_UNLOCKED_STATE: QuotaLockState = {
  bloqueado: false,
  motivo: '',
  recurso: 'COTA_DIARIA',
  detectadoEmIso: '',
};

let _quotaLockState: QuotaLockState = { ...DEFAULT_UNLOCKED_STATE };
const _quotaListeners = new Set<(state: QuotaLockState) => void>();

function loadQuotaLockFromStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const savedV2 = localStorage.getItem(STORAGE_KEY_QUOTA_LOCK);
    if (savedV2) {
      const parsed = JSON.parse(savedV2) as Partial<QuotaLockState>;
      if (parsed && parsed.bloqueado === true) {
        _quotaLockState = {
          bloqueado: true,
          motivo: parsed.motivo || 'Cota diária gratuita do Firebase Spark excedida (resource-exhausted).',
          recurso: parsed.recurso || 'COTA_DIARIA',
          detectadoEmIso: parsed.detectadoEmIso || new Date().toISOString(),
          ultimaVerificacaoEmIso: parsed.ultimaVerificacaoEmIso,
          ultimaRespostaServidor: parsed.ultimaRespostaServidor,
        };
        return;
      }
    }

    // Migrar bloqueio legado se ainda ativo, porém SEM expiração automática por relógio
    const legacy = localStorage.getItem(STORAGE_KEY_QUOTA_LEGACY);
    if (legacy && Number(legacy) > Date.now()) {
      _quotaLockState = {
        bloqueado: true,
        motivo: 'Bloqueio preventivo de cota diária gratuita do Firebase Spark ativo.',
        recurso: 'COTA_DIARIA',
        detectadoEmIso: new Date().toISOString(),
      };
      saveQuotaLockToStorage();
    }
  } catch {
    // Fallback seguro em memória
  }
}

function saveQuotaLockToStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    if (_quotaLockState.bloqueado) {
      localStorage.setItem(STORAGE_KEY_QUOTA_LOCK, JSON.stringify(_quotaLockState));
    } else {
      localStorage.removeItem(STORAGE_KEY_QUOTA_LOCK);
      localStorage.removeItem(STORAGE_KEY_QUOTA_LEGACY);
    }
  } catch {
    // Ignorar falha de armazenamento
  }
}

function notifyQuotaListeners(): void {
  const snapshot = getQuotaLockState();
  _quotaListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // Ignorar erro de listener individual
    }
  });
}

loadQuotaLockFromStorage();

/**
 * Retorna true enquanto houver bloqueio confirmado de cota diária.
 * NUNCA expira automaticamente apenas porque passou um período fixo de tempo.
 */
export function isFirestoreQuotaExceeded(): boolean {
  return _quotaLockState.bloqueado === true;
}

export function getQuotaLockState(): QuotaLockState {
  return { ..._quotaLockState };
}

export function subscribeQuotaStatus(listener: (state: QuotaLockState) => void): () => void {
  _quotaListeners.add(listener);
  listener(getQuotaLockState());
  return () => {
    _quotaListeners.delete(listener);
  };
}

export function detectQuotaResourceType(err: unknown): QuotaResourceType {
  if (!err) return 'COTA_DIARIA';
  const msg = String((err as any)?.message || (err as any)?.code || err).toLowerCase();
  if (msg.includes('write') || msg.includes('escrita') || msg.includes('commit') || msg.includes('setdoc')) {
    return 'ESCRITA';
  }
  if (msg.includes('read') || msg.includes('leitura') || msg.includes('getdoc')) {
    return 'LEITURA';
  }
  return 'COTA_DIARIA';
}

export function markQuotaExceeded(motivo?: string, recurso?: QuotaResourceType): void {
  const agora = new Date().toISOString();
  _quotaLockState = {
    bloqueado: true,
    motivo:
      motivo ||
      'Cota diária gratuita do Firebase Spark excedida (resource-exhausted). Novas gravações na nuvem bloqueadas até confirmação explícita de liberação.',
    recurso: recurso || _quotaLockState.recurso || 'COTA_DIARIA',
    detectadoEmIso: _quotaLockState.bloqueado && _quotaLockState.detectadoEmIso ? _quotaLockState.detectadoEmIso : agora,
    ultimaVerificacaoEmIso: _quotaLockState.ultimaVerificacaoEmIso,
    ultimaRespostaServidor: _quotaLockState.ultimaRespostaServidor,
  };
  saveQuotaLockToStorage();
  notifyQuotaListeners();
  console.warn(
    `[Firestore] BLOQUEIO DE COTA DIÁRIA SPARK ATIVADO (${_quotaLockState.recurso}). Operando 100% local via IndexedDB sem retentativas automáticas.`
  );
}

export function resetQuotaExceeded(): void {
  _quotaLockState = { ...DEFAULT_UNLOCKED_STATE };
  saveQuotaLockToStorage();
  notifyQuotaListeners();
}

export function isQuotaError(err: any): boolean {
  if (!err) return false;
  const code = String(err?.code || '').toLowerCase();
  const msg = String(err?.message || err?.code || err).toLowerCase();

  // Distinguir erro de estouro de memória de consulta pontual (128 MiB in-memory query limit)
  // que NÃO é esgotamento de cota diária do projeto Firebase
  if (
    msg.includes('128.00 mib') ||
    msg.includes('128.14 mib') ||
    msg.includes('128 mib') ||
    msg.includes('134,367,920') ||
    msg.includes('scanning over large documents') ||
    msg.includes('attempted to use')
  ) {
    return false;
  }

  // Distinguir falhas de rede/offline simples (não são esgotamento de cota)
  if (
    (msg.includes('client is offline') ||
      msg.includes('network-request-failed') ||
      code === 'unavailable') &&
    !msg.includes('quota') &&
    !msg.includes('resource-exhausted')
  ) {
    return false;
  }

  return (
    code === 'resource-exhausted' ||
    code === 'quota-exceeded' ||
    msg.includes('resource-exhausted') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota-exceeded') ||
    msg.includes('quota limit exceeded') ||
    msg.includes('free daily') ||
    msg.includes('daily quota') ||
    msg.includes('exceeded its quota') ||
    msg.includes('exceeded the quota') ||
    msg.includes('quota')
  );
}

/**
 * Executa apenas UMA verificação leve sob demanda (1 leitura, 0 escritas) no servidor
 * para confirmar se a cota diária do Firebase Spark foi restabelecida após o reset.
 * Nunca desbloqueia em caso de erro de cota, falha de rede ou ausência de resposta do servidor.
 */
export async function verificarLiberacaoCotaNoServidor(
  probeFn?: () => Promise<unknown>
): Promise<{ liberada: boolean; status: QuotaLockState; mensagem: string }> {
  const agoraIso = new Date().toISOString();

  if (typeof navigator !== 'undefined' && navigator.onLine === false && !probeFn) {
    _quotaLockState = {
      ..._quotaLockState,
      ultimaVerificacaoEmIso: agoraIso,
      ultimaRespostaServidor: 'Dispositivo offline — verificação não executada.',
    };
    saveQuotaLockToStorage();
    notifyQuotaListeners();
    return {
      liberada: false,
      status: getQuotaLockState(),
      mensagem: 'Dispositivo sem internet. O bloqueio preventivo de cota foi mantido.',
    };
  }

  try {
    const runProbe =
      probeFn ||
      (async () => {
        const { doc, getDocFromServer } = await import('firebase/firestore');
        if (!db) {
          throw new Error('Firestore não inicializado.');
        }
        const probeRef = doc(db, 'filiais', '172', 'config', 'versao_ativa_rub');
        await getDocFromServer(probeRef);
      });

    await Promise.race([
      runProbe(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Tempo limite de verificação de cota excedido (10s).')), 10000)
      ),
    ]);

    const eraEscrita = _quotaLockState.recurso === 'ESCRITA';
    resetQuotaExceeded();

    return {
      liberada: true,
      status: getQuotaLockState(),
      mensagem: eraEscrita
        ? 'Servidor respondeu normalmente (1 leitura). Bloqueio liberado — retome publicando uma base por vez após o reset diário do Spark.'
        : 'Servidor respondeu normalmente à verificação. Publicações em nuvem liberadas.',
    };
  } catch (err: any) {
    const msgErr = String(err?.message || err || 'Erro desconhecido');
    const continuaCota = isQuotaError(err);

    _quotaLockState = {
      ..._quotaLockState,
      bloqueado: true,
      recurso: continuaCota ? detectQuotaResourceType(err) : _quotaLockState.recurso,
      ultimaVerificacaoEmIso: agoraIso,
      ultimaRespostaServidor: msgErr,
    };
    saveQuotaLockToStorage();
    notifyQuotaListeners();

    return {
      liberada: false,
      status: getQuotaLockState(),
      mensagem: continuaCota
        ? 'A cota diária gratuita do Firebase Spark continua esgotada no servidor. Aguarde o reset diário (meia-noite PT) antes de retomar.'
        : `Não foi possível confirmar a liberação no servidor (${msgErr}). O bloqueio preventivo permanece ativo.`,
    };
  }
}

/**
 * Log padronizado de auditoria de leituras do Firestore para verificação (Requisito 20)
 */
export function logFirestoreRead(operacao: string, colecao: string, docsRetornados: number): void {
  console.log(
    `[Firestore]\nOperação: ${operacao}\nColeção: ${colecao}\nDocumentos retornados: ${docsRetornados}`
  );
}

let authPromise: Promise<User | null> | null = null;

export async function ensureAuth(): Promise<User | null> {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  if (authPromise) {
    return authPromise;
  }

  authPromise = new Promise((resolve) => {
    // Timeout after 2.5s so Firestore operations are never blocked
    const timer = setTimeout(() => {
      resolve(auth.currentUser || null);
    }, 2500);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        clearTimeout(timer);
        unsubscribe();
        resolve(user);
      } else {
        try {
          const cred = await signInAnonymously(auth);
          clearTimeout(timer);
          unsubscribe();
          resolve(cred.user);
        } catch (err) {
          clearTimeout(timer);
          // Anonymous auth might not be enabled; continue unauthenticated
          unsubscribe();
          resolve(null);
        }
      }
    });
  });

  return authPromise;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: Array<{
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  if (isQuotaError(error)) {
    markQuotaExceeded((error as any)?.message, detectQuotaResourceType(error));
  }
  const currentUser = auth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface SyncServiceErrorDetail {
  servico: string;
  colecao: string;
  operacao: OperationType;
  codigoErro: string;
  exigeGerenciaAdmin: boolean;
  isCotaExcedida: boolean;
  mensagemOriginal: string;
  mensagemUsuario: string;
}

/**
 * Formata erros do Firebase Firestore preservando serviço, coleção e operação exatos.
 * Nunca mascara erros de permissão (`permission-denied`) ou cota (`resource-exhausted`).
 */
export function formatarErroSyncPorServico(
  error: unknown,
  servico: string,
  colecao: string,
  operacao: OperationType = OperationType.WRITE
): SyncServiceErrorDetail {
  const rawCode = String((error as any)?.code || '').trim();
  const rawMessage = error instanceof Error ? error.message : String(error || 'Erro desconhecido');
  const lowerCode = rawCode.toLowerCase();
  const lowerMsg = rawMessage.toLowerCase();

  const isCota = isQuotaError(error);
  if (isCota) {
    markQuotaExceeded(rawMessage, detectQuotaResourceType(error));
  }

  const isPermission =
    lowerCode.includes('permission') ||
    lowerMsg.includes('permission-denied') ||
    lowerMsg.includes('missing or insufficient permissions');

  const currentUser = auth?.currentUser;
  if (isPermission) {
    const errInfo: FirestoreErrorInfo = {
      error: rawMessage,
      authInfo: {
        userId: currentUser?.uid,
        email: currentUser?.email,
        emailVerified: currentUser?.emailVerified,
        isAnonymous: currentUser?.isAnonymous,
        tenantId: currentUser?.tenantId,
        providerInfo:
          currentUser?.providerData.map((provider) => ({
            providerId: provider.providerId,
            displayName: provider.displayName,
            email: provider.email,
            photoUrl: provider.photoURL,
          })) || [],
      },
      operationType: operacao,
      path: colecao,
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  }

  let codigoErro = rawCode || 'unknown';
  if (isPermission) codigoErro = 'permission-denied';
  else if (isCota) codigoErro = 'resource-exhausted';
  else if (lowerCode === 'unavailable' || lowerMsg.includes('offline')) codigoErro = 'unavailable';

  let mensagemUsuario: string;
  if (isPermission) {
    const motivoAuth = !currentUser || currentUser.isAnonymous
      ? 'dispositivo sem login Google verificado da Gerência (GERENCIA_ADMIN)'
      : 'usuário autenticado não autorizado ou payload incompatível com as regras da coleção';
    mensagemUsuario = `[${servico} • Coleção: ${colecao}] Permissão recusada no Firestore (${codigoErro}): ${motivoAuth}. Detalhe: ${rawMessage}`;
  } else if (isCota) {
    mensagemUsuario = `[${servico} • Coleção: ${colecao}] Cota diária gratuita do Firebase Spark atingida (${codigoErro}). Dados locais no IndexedDB preservados.`;
  } else {
    mensagemUsuario = `[${servico} • Coleção: ${colecao}] Falha na operação "${operacao}" (${codigoErro}): ${rawMessage}`;
  }

  return {
    servico,
    colecao,
    operacao,
    codigoErro,
    exigeGerenciaAdmin: isPermission,
    isCotaExcedida: isCota,
    mensagemOriginal: rawMessage,
    mensagemUsuario,
  };
}

export async function testConnection(): Promise<boolean> {
  if (!db || isFirestoreQuotaExceeded()) return false;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration. The client is offline.');
    }
    return false;
  }
}

// Auto-trigger auth & startup connection test in browser context
ensureAuth().catch(() => {});
if (typeof window !== 'undefined' && !isFirestoreQuotaExceeded()) {
  void testConnection();
}

export { app, auth, db };

