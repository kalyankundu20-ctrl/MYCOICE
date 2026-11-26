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
  historyTruncated?: boolean;
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

let cachedIdbPromise: Promise<IDBDatabase | null> | null = null;

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  if (cachedIdbPromise) return cachedIdbPromise;
  cachedIdbPromise = new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          cachedIdbPromise = null;
        };
        db.onclose = () => {
          cachedIdbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        cachedIdbPromise = null;
        resolve(null);
      };
      req.onblocked = () => {
        cachedIdbPromise = null;
        resolve(null);
      };
    } catch {
      cachedIdbPromise = null;
      resolve(null);
    }
  });
  return cachedIdbPromise;
}

export function scheduleIdlePersistence(task: () => void, timeoutMs = 220): () => void {
  if (typeof window === 'undefined') return () => {};
  const win = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof win.requestIdleCallback === 'function') {
    const id = win.requestIdleCallback(() => task(), { timeout: timeoutMs });
    return () => win.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(task, Math.min(80, timeoutMs));
  return () => window.clearTimeout(id);
}

function countSnapshotRows(snaps: AppState['history'] | undefined): number {
  if (!Array.isArray(snaps)) return 0;
  let total = 0;
  for (let i = 0; i < snaps.length; i++) {
    const e = snaps[i]?.entries;
    if (!e) continue;
    total += (e['1PM']?.length || 0) + (e['6PM']?.length || 0) + (e['8PM']?.length || 0);
  }
  return total;
}

export function writeLocalStorageSafe(state: AppState, updatedAt: number): void {
  if (typeof window === 'undefined') return;

  // At high row counts (e.g. 2,000–30,000+ rows across 1PM/6PM/8PM), synchronous JSON.stringify
  // blocks the main thread and risks exceeding localStorage's ~5MB quota. IndexedDB persists the
  // full state asynchronously with a newer updatedAt and always wins on recovery!
  const totalEntryRows =
    (state.entries?.['1PM']?.length || 0) +
    (state.entries?.['6PM']?.length || 0) +
    (state.entries?.['8PM']?.length || 0);
  if (totalEntryRows > 2200) {
    return;
  }

  // Never synchronously JSON.stringify huge 30-day archive history arrays into localStorage
  // (IndexedDB stores 100% of full history & recycleBin asynchronously without blocking UI!).
  const historyRows = countSnapshotRows(state.history);
  const recycleRows = countSnapshotRows(state.recycleBin);
  const shouldCompactHistory = historyRows + recycleRows > 1200;
  const compactForLocal: AppState = shouldCompactHistory
    ? {
        ...state,
        history: (state.history || []).slice(0, 2),
        recycleBin: [],
      }
    : state;

  const tryWrite = (candidateState: AppState, historyTruncated: boolean): boolean => {
    try {
      const payload: PersistedEnvelope = historyTruncated
        ? { state: candidateState, updatedAt, historyTruncated: true }
        : { state: candidateState, updatedAt };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  };

  if (tryWrite(compactForLocal, shouldCompactHistory)) return;

  // Fallback on QuotaExceededError: keep live sheets/sellers/winning numbers intact, trim history
  // and mark historyTruncated so boot recovery always restores full history from IndexedDB/Cloud.
  if (
    tryWrite(
      {
        ...state,
        history: [],
        recycleBin: [],
      },
      true
    )
  ) {
    return;
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
      return {
        state: parsed.state,
        updatedAt: parsed.updatedAt,
        historyTruncated: Boolean(parsed.historyTruncated),
      };
    }
    if (parsed && parsed.sellers && parsed.entries) {
      return { state: parsed as AppState, updatedAt: 0 };
    }
    return null;
  } catch {
    return null;
  }
}

let idbWriteInFlight = false;
let pendingIdbEnvelope: PersistedEnvelope | null = null;

async function writeSingleIdbEnvelope(envelope: PersistedEnvelope): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(envelope, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      cachedIdbPromise = null;
      resolve();
    }
  });
}

export async function writeIndexedDbEnvelope(
  state: AppState,
  updatedAt: number
): Promise<void> {
  // Coalesce rapid successive writes so only the newest snapshot is written to IndexedDB
  pendingIdbEnvelope = { state, updatedAt };
  if (idbWriteInFlight) return;
  idbWriteInFlight = true;
  try {
    while (pendingIdbEnvelope) {
      const next = pendingIdbEnvelope;
      pendingIdbEnvelope = null;
      await writeSingleIdbEnvelope(next);
    }
  } finally {
    idbWriteInFlight = false;
  }
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
        if (val && val.state && typeof val.updatedAt === 'number') {
          resolve(val);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      cachedIdbPromise = null;
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
    } catch {
      cachedIdbPromise = null;
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
        if (val && Array.isArray(val.sellers) && typeof val.updatedAt === 'number') {
          resolve(val);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => {
        resolve(null);
      };
    } catch {
      cachedIdbPromise = null;
      resolve(null);
    }
  });
}
