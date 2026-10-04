"use client";
// IndexedDB-backed queue store. Survives reloads, app restarts and the phone sleeping in a truck all afternoon.
import { memoryStore } from "@/lib/offline/queue";
import type { QueuedLog, QueueStore } from "@/lib/offline/types";

const DB_NAME = "dilly-offline";
const STORE = "logs";
const VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "key" });
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    r.onerror = () => reject(r.error ?? new Error("IndexedDB unavailable"));
    r.onblocked = () => reject(new Error("IndexedDB blocked"));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  const t = db.transaction(STORE, mode);
  const out = await req(fn(t.objectStore(STORE)));
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error("IndexedDB transaction failed"));
    t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
  });
  return out;
}

export function idbStore(): QueueStore {
  return {
    list: () => tx("readonly", (s) => s.getAll() as IDBRequest<QueuedLog[]>),
    put: async (item) => {
      await tx("readwrite", (s) => s.put(item));
    },
    remove: async (key) => {
      await tx("readwrite", (s) => s.delete(key));
    },
  };
}

let shared: QueueStore | null = null;
/** The device queue: IndexedDB when available, else memory (lost on reload — rare: very old private-mode Safari). */
export function deviceQueue(): QueueStore {
  if (shared) return shared;
  const fallback = memoryStore();
  if (typeof indexedDB === "undefined") return (shared = fallback);
  const idb = idbStore();
  let broken = false;
  const pick = async <T>(fn: (s: QueueStore) => Promise<T>): Promise<T> => {
    if (!broken) {
      try {
        return await fn(idb);
      } catch {
        broken = true;
      }
    }
    return fn(fallback);
  };
  shared = { list: () => pick((s) => s.list()), put: (i) => pick((s) => s.put(i)), remove: (k) => pick((s) => s.remove(k)) };
  return shared;
}
