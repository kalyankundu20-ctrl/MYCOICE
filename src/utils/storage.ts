import { AppState, Seller } from '../types/ledger';

export const STORAGE_KEY = 'kk-agency-ledger-v1';
export const PERMANENT_SELLERS_KEY = 'kk-agency-permanent-sellers-v1';
const IDB_NAME = 'kk-agency-ledger-db';
const IDB_STORE = 'state';
const IDB_KEY = 'current';
const IDB_SELLERS_KEY = 'permanent_sellers';

export interface PersistedEnvelope {
  state: AppState;
  updatedAt: number;
}

export interface PermanentSellersEnvelope {
  sellers: Seller[];
  updatedAt: number;
}

export function requestPersistentStorage(): void {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.persist === 'function'
    ) {
      void navigator.storage.persist();
    }
  } catch {
    // Ignore unsupported browsers
  }
}

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function writeLocalStorageSafe(state: AppState, updatedAt: number): void {
  if (typeof window === 'undefined') return;

  const tryWrite = (candidateState: AppState): boolean => {
    try {
      const payload: PersistedEnvelope = { state: candidateState, updatedAt };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  };

  if (tryWrite(state)) return;

  // Fallback on QuotaExceededError: keep all live sheets/sellers/winning numbers intact,
  // and trim archived history snapshots in localStorage (full history still goes to IndexedDB).
  for (const limit of [20, 5, 0]) {
    if (
      tryWrite({
        ...state,
        history: state.history.slice(0, limit),
      })
    ) {
      return;
    }
  }
}

export function readLocalStorageEnvelope(): PersistedEnvelope | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedEnvelope> & Partial<AppState>;
    // Support new envelope format { state, updatedAt } as well as legacy raw AppState
    if (parsed && parsed.state && typeof parsed.updatedAt === 'number') {
      return { state: parsed.state, updatedAt: parsed.updatedAt };
    }
    if (parsed && parsed.sellers && parsed.entries) {
      return { state: parsed as AppState, updatedAt: 0 };
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeIndexedDbEnvelope(
  state: AppState,
  updatedAt: number
): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put({ state, updatedAt } satisfies PersistedEnvelope, IDB_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function readIndexedDbEnvelope(): Promise<PersistedEnvelope | null> {
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);
      req.onsuccess = () => {
        const val = req.result as PersistedEnvelope | undefined;
        db.close();
        if (val && val.state && typeof val.updatedAt === 'number') {
          resolve(val);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

// =============================================================================
// PERMANENT SELLER VAULT (Dedicated LocalStorage + IndexedDB Persistence)
// Sellers created by the user stay permanently saved until explicitly deleted.
// =============================================================================
export function writePermanentSellers(sellers: Seller[], updatedAt: number): void {
  if (typeof window === 'undefined') return;
  const payload: PermanentSellersEnvelope = { sellers, updatedAt };
  try {
    window.localStorage.setItem(PERMANENT_SELLERS_KEY, JSON.stringify(payload));
  } catch {
    // Ignore localStorage quota failure; IndexedDB below still stores it
  }

  void openIdb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(payload, IDB_SELLERS_KEY);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    } catch {
      db.close();
    }
  });
}

export function readPermanentSellersLocal(): PermanentSellersEnvelope | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PERMANENT_SELLERS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PermanentSellersEnvelope>;
    if (parsed && Array.isArray(parsed.sellers) && typeof parsed.updatedAt === 'number') {
      return { sellers: parsed.sellers, updatedAt: parsed.updatedAt };
    }
    return null;
  } catch {
    return null;
  }
}

export async function readPermanentSellersIdb(): Promise<PermanentSellersEnvelope | null> {
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_SELLERS_KEY);
      req.onsuccess = () => {
        const val = req.result as PermanentSellersEnvelope | undefined;
        db.close();
        if (val && Array.isArray(val.sellers) && typeof val.updatedAt === 'number') {
          resolve(val);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}
