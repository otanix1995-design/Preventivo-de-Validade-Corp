import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import {
  Firestore,
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
// CONTROLE DE COTA DO FIRESTORE & LOGS DE LEITURA (REQUISITO 17 E 20)
// ============================================================================

let _quotaExceededUntil = 0;
const QUOTA_BACKOFF_MS = 15 * 60 * 1000; // 15 minutos de proteção para evitar loops

export function isFirestoreQuotaExceeded(): boolean {
  return Date.now() < _quotaExceededUntil;
}

export function markQuotaExceeded(): void {
  _quotaExceededUntil = Date.now() + QUOTA_BACKOFF_MS;
  console.warn(
    `[Firestore] COTA EXCEDIDA detectada (Free daily read/write limit). Pausando tentativas de rede por 15 minutos. Operação 100% local.`
  );
}

export function resetQuotaExceeded(): void {
  _quotaExceededUntil = 0;
}

export function isQuotaError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || err?.code || err).toLowerCase();
  return (
    msg.includes('resource-exhausted') ||
    msg.includes('quota-exceeded') ||
    msg.includes('quota limit exceeded') ||
    msg.includes('free daily read units') ||
    msg.includes('exceeded its quota') ||
    msg.includes('quota')
  );
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

// Auto-trigger auth on load
ensureAuth().catch(() => {});

export { app, auth, db };
