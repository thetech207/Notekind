/* Tiny promise-wrapped IndexedDB KV store. Shared by extension pages
   and the service worker — both run on the chrome-extension:// origin,
   so a FileSystemDirectoryHandle stored here is reachable from either
   context. */
const DB = 'notekind';
const STORE = 'kv';

function open() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function idbGet(key) {
  const db = await open();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function idbSet(key, val) {
  const db = await open();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

export async function idbDel(key) {
  const db = await open();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}
