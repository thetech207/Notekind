import { idbGet, idbSet, idbDel } from '../idb.js';
import { writeNote, listNotes, vaultState, mirrorAll, importVault, exportZip }
  from '../store.js';

const $ = id => document.getElementById(id);
const log = m => { $('log').textContent += `[${new Date().toLocaleTimeString()}] ${m}\n`; };
const VAULT_KEY = 'vault';
const SPIKE_FILE = 'notekind-spike.md';

async function refresh() {
  const { handle, state } = await vaultState();
  $('vaultStatus').innerHTML = handle
    ? `<b>${handle.name}</b> — permission: <b>${state}</b> ` +
      (state === 'granted'
        ? '<span class="ok">sync ON — writes mirror to .md files</span>'
        : '<span class="dim">sync off — click Enable sync (one gesture per session)</span>')
    : 'No vault selected — notes are stored internally only.';
  const notes = await listNotes();
  $('noteCount').textContent = notes.length ? `(${notes.length})` : '';
  $('noteList').textContent = notes.map(n => n.path).join('\n') || '(no notes yet)';
}

$('pick').onclick = async () => {
  try {
    const h = await showDirectoryPicker({ mode: 'readwrite' });
    const st = await h.requestPermission({ mode: 'readwrite' });
    if (st !== 'granted') { log(`permission not granted: ${st}`); return; }
    await idbSet(VAULT_KEY, h);
    log(`vault saved: ${h.name}`);
    refresh();
  } catch (e) {
    if (e.name !== 'AbortError') log(`pick failed (${e.name}): ${e.message}`);
  }
};

$('sync').onclick = async () => {
  const h = await idbGet(VAULT_KEY);
  if (!h) return log('no vault selected');
  const st = await h.requestPermission({ mode: 'readwrite' });
  log(`permission → ${st}`);
  if (st === 'granted') {
    const n = await mirrorAll(h);
    log(`mirrored ${n} item(s) to vault`);
  }
  refresh();
};

$('import').onclick = async () => {
  const h = await idbGet(VAULT_KEY);
  if (!h) return log('no vault selected');
  const st = await h.requestPermission({ mode: 'readwrite' });
  if (st !== 'granted') return log(`import needs permission (got ${st})`);
  const n = await importVault(h);
  log(`imported ${n} file(s) from vault into IDB`);
  refresh();
};

$('forget').onclick = async () => {
  await idbDel(VAULT_KEY);
  log('handle forgotten — vault files on disk are untouched');
  refresh();
};

$('export').onclick = async () => {
  const blob = await exportZip();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'notekind-vault.zip';
  a.click();
  URL.revokeObjectURL(a.href);
  log(`exported ${Math.round(blob.size / 1024)}KB zip`);
};

async function writeTest(source) {
  try {
    const r = source === 'sw'
      ? await chrome.runtime.sendMessage({ type: 'nk-test-write' })
      : await writeNote(SPIKE_FILE,
          `notekind write via page @ ${new Date().toISOString()}\n`);
    log(`${source} write → ${JSON.stringify(r)}`);
    refresh();
  } catch (e) {
    log(`${source} write failed (${e.name}): ${e.message}`);
  }
}

$('wPage').onclick = () => writeTest('page');
$('wSw').onclick = () => writeTest('sw');

chrome.storage.local.get(['nkStartup', 'nkMenuTest']).then(({ nkStartup, nkMenuTest }) => {
  if (nkStartup) $('startupRes').textContent = JSON.stringify(nkStartup);
  if (nkMenuTest) $('menuRes').textContent = JSON.stringify(nkMenuTest);
});
chrome.storage.onChanged.addListener(ch => {
  if (ch.nkStartup) $('startupRes').textContent = JSON.stringify(ch.nkStartup.newValue);
  if (ch.nkMenuTest) $('menuRes').textContent = JSON.stringify(ch.nkMenuTest.newValue);
});

refresh();
