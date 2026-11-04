import { idbGet, idbSet, idbDel } from './idb.js';
import { vaultState, mirrorAll, importVault, exportZip } from './store.js';

const $ = id => document.getElementById(id);
const VAULT_KEY = 'vault';
const st = m => { $('vaultStatus').textContent = m; };

$('ver').textContent = 'v' + chrome.runtime.getManifest().version;

/* ---------- settings ---------- */

(async () => {
  $('setNewTab').checked = (await idbGet('openOnNewTab')) !== false;
  $('setNewTab').onchange = e => idbSet('openOnNewTab', e.target.checked);

  $('setBackup').checked = (await idbGet('backupEnabled')) !== false;
  $('setBackup').onchange = e => idbSet('backupEnabled', e.target.checked);

  $('setFont').value = (await idbGet('editorFontSize')) || '';
  $('setFont').onchange = e => idbSet('editorFontSize', e.target.value || null);

  const theme = (await idbGet('theme')) || 'dark';
  document.documentElement.dataset.theme = theme;
  $('setTheme').value = theme;
  $('setTheme').onchange = e => {
    idbSet('theme', e.target.value);
    document.documentElement.dataset.theme = e.target.value;
  };
})();

/* ---------- vault ---------- */

async function refreshVault() {
  const { handle, state } = await vaultState();
  st(handle
    ? `${handle.name} — ${state === 'granted' ? 'syncing' : 'sync off (click Enable sync)'}`
    : 'No vault — notes stay internal until you export or sync.');
}

$('pick').onclick = async () => {
  try {
    const h = await showDirectoryPicker({ mode: 'readwrite' });
    if (await h.requestPermission({ mode: 'readwrite' }) !== 'granted') return;
    await idbSet(VAULT_KEY, h);
    refreshVault();
  } catch (e) { if (e.name !== 'AbortError') st(`pick failed: ${e.message}`); }
};

$('sync').onclick = async () => {
  const h = await idbGet(VAULT_KEY);
  if (!h) return $('pick').onclick();
  if (await h.requestPermission({ mode: 'readwrite' }) === 'granted') {
    const r = await mirrorAll(h);
    st(`mirrored ${r.n} item(s)` + (r.failed.length ? ` — failed: ${r.failed.join(', ')}` : ''));
  }
  refreshVault();
};

$('import').onclick = async () => {
  const h = await idbGet(VAULT_KEY);
  if (!h) return st('no vault selected');
  if (await h.requestPermission({ mode: 'readwrite' }) !== 'granted')
    return st('import needs permission');
  st(`imported ${await importVault(h)} file(s)`);
};

$('export').onclick = async () => {
  const blob = await exportZip();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'notekind-vault.zip';
  a.click();
  URL.revokeObjectURL(a.href);
};

$('forget').onclick = async () => {
  await idbDel(VAULT_KEY);
  refreshVault();
};

refreshVault();
