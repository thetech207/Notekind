import { idbGet, idbSet, idbDel } from '../idb.js';

const $ = id => document.getElementById(id);
const log = m => { $('log').textContent += `[${new Date().toLocaleTimeString()}] ${m}\n`; };
const SPIKE_FILE = 'notekind-spike.txt';

async function refresh() {
  const h = await idbGet('vault');
  if (!h) { $('vaultStatus').textContent = 'No vault selected.'; return; }
  const st = await h.queryPermission({ mode: 'readwrite' });
  $('vaultStatus').innerHTML =
    `<b>${h.name}</b> — permission: <b>${st}</b> <span class="dim">(handle persisted in IndexedDB)</span>`;
}

$('pick').onclick = async () => {
  try {
    const h = await showDirectoryPicker({ mode: 'readwrite' });
    const st = await h.requestPermission({ mode: 'readwrite' });
    if (st !== 'granted') { log(`permission not granted: ${st}`); return; }
    await idbSet('vault', h);
    log(`vault saved: ${h.name}`);
    refresh();
  } catch (e) {
    if (e.name !== 'AbortError') log(`pick failed (${e.name}): ${e.message}`);
  }
};

$('reperm').onclick = async () => {
  const h = await idbGet('vault');
  if (!h) return log('no handle');
  const st = await h.requestPermission({ mode: 'readwrite' });
  log(`re-request → ${st}`);
  refresh();
};

$('forget').onclick = async () => {
  await idbDel('vault');
  log('handle forgotten');
  refresh();
};

$('wPage').onclick = async () => {
  const h = await idbGet('vault');
  if (!h) return log('no handle');
  try {
    const fh = await h.getFileHandle(SPIKE_FILE, { create: true });
    const w = await fh.createWritable();
    await w.write(`notekind write via page @ ${new Date().toISOString()}\n`);
    await w.close();
    log('page write OK → ' + SPIKE_FILE);
  } catch (e) {
    log(`page write failed (${e.name}): ${e.message}`);
  }
};

$('wSw').onclick = async () => {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'nk-test-write' });
    log(`SW write → ${JSON.stringify(r)}`);
  } catch (e) {
    log(`SW message failed: ${e.message}`);
  }
};

chrome.storage.local.get(['nkStartup', 'nkMenuTest']).then(({ nkStartup, nkMenuTest }) => {
  if (nkStartup) $('startupRes').textContent = JSON.stringify(nkStartup);
  if (nkMenuTest) $('menuRes').textContent = JSON.stringify(nkMenuTest);
});
chrome.storage.onChanged.addListener(ch => {
  if (ch.nkStartup) $('startupRes').textContent = JSON.stringify(ch.nkStartup.newValue);
  if (ch.nkMenuTest) $('menuRes').textContent = JSON.stringify(ch.nkMenuTest.newValue);
});

refresh();
