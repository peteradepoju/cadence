// A tiny key-value store in IndexedDB. The device copy of everything lives here,
// so Cadence opens instantly and works offline.

const DB = "cadence", STORE = "kv", BLOBS = "blobs";
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then(db => new Promise<T>((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? (req.result as T) : (undefined as T));
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export const idb = {
  get: <T>(key: string) => tx<T | undefined>(STORE, "readonly", s => s.get(key) as IDBRequest<T | undefined>),
  set: (key: string, value: unknown) => tx<void>(STORE, "readwrite", s => { s.put(value, key); }),
  del: (key: string) => tx<void>(STORE, "readwrite", s => { s.delete(key); }),
  keys: () => tx<IDBValidKey[]>(STORE, "readonly", s => s.getAllKeys()),
  clear: () => Promise.all([tx<void>(STORE, "readwrite", s => { s.clear(); }), tx<void>(BLOBS, "readwrite", s => { s.clear(); })]),
  getBlob: (key: string) => tx<Blob | undefined>(BLOBS, "readonly", s => s.get(key) as IDBRequest<Blob | undefined>),
  setBlob: (key: string, b: Blob) => tx<void>(BLOBS, "readwrite", s => { s.put(b, key); }),
  delBlob: (key: string) => tx<void>(BLOBS, "readwrite", s => { s.delete(key); }),
};
