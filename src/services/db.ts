/**
 * Native IndexedDB persistence layer for Controle de Vencimentos
 * Provides unlimited, quota-free, async structured storage for large datasets (11,600+ products).
 */

const DB_NAME = 'ControleVencimentosDB_v2';
const DB_VERSION = 2;

export const STORES = {
  PRODUTOS: 'produtos',
  VINCULOS_EAN: 'vinculos_ean',
  VENCIMENTOS: 'vencimentos',
  DIVERGENCIAS: 'divergencias',
  HISTORICO_IMPORTACOES: 'historico_importacoes',
  METADADOS: 'metadados',
  SAEOU060: 'saeou060',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB não suportado neste navegador.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORES.PRODUTOS)) {
        db.createObjectStore(STORES.PRODUTOS, { keyPath: 'codigo_interno' });
      }
      if (!db.objectStoreNames.contains(STORES.VINCULOS_EAN)) {
        db.createObjectStore(STORES.VINCULOS_EAN, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.VENCIMENTOS)) {
        db.createObjectStore(STORES.VENCIMENTOS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.DIVERGENCIAS)) {
        db.createObjectStore(STORES.DIVERGENCIAS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.HISTORICO_IMPORTACOES)) {
        db.createObjectStore(STORES.HISTORICO_IMPORTACOES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.METADADOS)) {
        db.createObjectStore(STORES.METADADOS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.SAEOU060)) {
        db.createObjectStore(STORES.SAEOU060, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('Erro ao abrir IndexedDB:', request.error);
      reject(request.error);
    };
  });

  return dbPromise;
}

export async function dbGetAll<T>(storeName: string): Promise<T[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();

      req.onsuccess = () => {
        resolve(req.result as T[]);
      };
      req.onerror = () => {
        reject(req.error);
      };
    });
  } catch (err) {
    console.error(`Erro ao ler todos os registros de ${storeName}:`, err);
    return [];
  }
}

export async function dbPutAll<T>(storeName: string, items: T[], clearFirst = true): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);

    if (clearFirst) {
      store.clear();
    }

    for (const item of items) {
      store.put(item);
    }

    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      console.error(`Erro ao salvar registros em lote em ${storeName}:`, tx.error);
      reject(tx.error);
    };
  });
}

export async function dbPut<T>(storeName: string, item: T): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(item);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.delete(key);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbClear(storeName: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbGetMeta<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORES.METADADOS, 'readonly');
      const store = tx.objectStore(STORES.METADADOS);
      const req = store.get(key);

      req.onsuccess = () => {
        if (req.result && req.result.value !== undefined) {
          resolve(req.result.value as T);
        } else {
          resolve(fallback);
        }
      };
      req.onerror = () => {
        resolve(fallback);
      };
    });
  } catch {
    return fallback;
  }
}

export async function dbSetMeta<T>(key: string, value: T): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.METADADOS, 'readwrite');
      const store = tx.objectStore(STORES.METADADOS);
      store.put({ key, value });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error(`Erro ao salvar metadado ${key}:`, err);
  }
}
