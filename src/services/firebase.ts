import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';
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

// Use custom firestoreDatabaseId if configured in project
if (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)') {
  db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
} else {
  db = getFirestore(app);
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
