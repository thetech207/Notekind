/* Tiny promise-wrapped IndexedDB layer. Shared by extension pages and
   the service worker (same chrome-extension:// origin).
   Stores: kv (misc, incl. the vault dir handle), notes (path → record),
   blobs (path → binary attachments). */
const DB = 'notekind';
export const STORES = { kv: 'kv', notes: 'notes', blobs: 'blobs' };

function open() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of Object.values(STORES))
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function call(store, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const r = fn(db.transaction(store, mode).objectStore(store));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

export const dbGet = (s, k) => call(s, 'readonly', o => o.get(k));
export const dbPut = (s, v, k) => call(s, 'readwrite', o => o.put(v, k));
export const dbDel = (s, k) => call(s, 'readwrite', o => o.delete(k));
export const dbKeys = s => call(s, 'readonly', o => o.getAllKeys());
export const dbAll = s => call(s, 'readonly', o => o.getAll());

export const idbGet = k => dbGet(STORES.kv, k);
export const idbSet = (k, v) => dbPut(STORES.kv, v, k);
export const idbDel = k => dbDel(STORES.kv, k);
