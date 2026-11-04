import { STORES, dbGet, dbPut, dbDel, dbAll, idbGet } from './idb.js';
import { zipSync, strToU8 } from './vendor/fflate.js';

/* Storage model: IndexedDB is the source of truth — notes are keyed by
   their vault-relative path ("2026/11 - November/2026-11-03.md"), so
   export and vault mirroring stay byte-identical to Tektite's layout.
   The vault dir handle lives in kv — when its permission is 'granted'
   this session, writes mirror out to real .md files automatically. */

const VAULT_KEY = 'vault';

export async function vaultState() {
  const h = await idbGet(VAULT_KEY);
  if (!h) return { handle: null, state: 'none' };
  let state = 'unknown';
  try { state = await h.queryPermission({ mode: 'readwrite' }); } catch {}
  return { handle: h, state };
}

/* ---------- notes ---------- */

export async function writeNote(path, text, { mirror = true } = {}) {
  await dbPut(STORES.notes, { path, text, mtime: Date.now() }, path);
  let mirrored = false;
  if (mirror) {
    const { handle, state } = await vaultState();
    if (handle && state === 'granted') {
      try { await mirrorWrite(handle, path, text); mirrored = true; }
      catch { /* mirror is best-effort — never break the IDB write */ }
    }
  }
  return { stored: true, mirrored };
}

export const readNote = p => dbGet(STORES.notes, p);

export async function listNotes() {
  const all = await dbAll(STORES.notes);
  return all.map(({ text, ...r }) => r).sort((a, b) => a.path < b.path ? -1 : 1);
}

export async function deleteNote(path, { mirror = true } = {}) {
  await dbDel(STORES.notes, path);
  let mirrored = false;
  if (mirror) {
    const { handle, state } = await vaultState();
    if (handle && state === 'granted') {
      try { await mirrorDelete(handle, path); mirrored = true; }
      catch { /* file may never have been mirrored — nothing to remove */ }
    }
  }
  return { stored: true, mirrored };
}

export async function putBlob(p, blob, { mirror = true } = {}) {
  await dbPut(STORES.blobs, { path: p, blob, mtime: Date.now() }, p);
  let mirrored = false;
  if (mirror) {
    const { handle, state } = await vaultState();
    if (handle && state === 'granted') {
      try { await mirrorWrite(handle, p, blob); mirrored = true; }
      catch { /* mirror is best-effort */ }
    }
  }
  return { stored: true, mirrored };
}
export const getBlob = p => dbGet(STORES.blobs, p);

/* ---------- vault mirror ---------- */

export async function mirrorWrite(dir, path, contents) {
  const parts = path.split('/');
  let d = dir;
  for (const p of parts.slice(0, -1))
    d = await d.getDirectoryHandle(p, { create: true });
  const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await fh.createWritable();
  await w.write(contents);
  await w.close();
}

async function mirrorDelete(dir, path) {
  const parts = path.split('/');
  let d = dir;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
  await d.removeEntry(parts[parts.length - 1]);
}

/* Mirror every note/blob out to the vault (used after enabling sync or
   on first import to reconcile). Returns count written. */
export async function mirrorAll(dir) {
  let n = 0;
  for (const { path, text } of await dbAll(STORES.notes)) {
    await mirrorWrite(dir, path, text); n++;
  }
  for (const { path, blob } of await dbAll(STORES.blobs)) {
    await mirrorWrite(dir, path, blob); n++;
  }
  return n;
}

/* ---------- import / export ---------- */

/* Import an existing vault (Tektite/Obsidian folder) into IDB — .md
   files become notes, everything else becomes blobs. */
export async function importVault(dir) {
  let n = 0;
  const walk = async (d, prefix) => {
    for await (const [name, h] of d.values()) {
      if (name.startsWith('.')) continue;
      const p = prefix + name;
      if (h.kind === 'directory') await walk(h, p + '/');
      else if (name.endsWith('.md')) {
        const f = await h.getFile();
        await writeNote(p, await f.text(), { mirror: false });
        n++;
      } else {
        await putBlob(p, await h.getFile());
        n++;
      }
    }
  };
  await walk(dir, '');
  return n;
}

/* Everything in IDB → a single .zip Blob of plain files. */
export async function exportZip() {
  const files = {};
  for (const { path, text } of await dbAll(STORES.notes))
    files[path] = strToU8(text);
  for (const { path, blob } of await dbAll(STORES.blobs))
    files[path] = new Uint8Array(await blob.arrayBuffer());
  return new Blob([zipSync(files)], { type: 'application/zip' });
}
