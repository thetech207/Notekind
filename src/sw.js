import { writeNote, vaultState } from './store.js';

const SPIKE_FILE = 'notekind-spike.md';

/* Write a note via the store: IDB write always succeeds silently (no
   permission model on IndexedDB). Vault mirroring only happens when the
   handle's readwrite permission is 'granted' this session. */
async function testWrite(source) {
  const { handle, state } = await vaultState();
  try {
    const r = await writeNote(
      SPIKE_FILE,
      `notekind write via ${source} @ ${new Date().toISOString()}\n`);
    return { ok: true, source, mirrored: r.mirrored, vault: state };
  } catch (e) {
    return { ok: false, source, reason: `${e.name}: ${e.message}`, vault: handle ? state : 'none' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'nk-test-write') {
    testWrite('message').then(sendResponse);
    return true; /* keep channel open for async response */
  }
});

/* Demonstrates the model at browser startup: the IDB write lands with
   no gesture at all; mirroring only kicks in if permission persisted. */
chrome.runtime.onStartup.addListener(async () => {
  const r = await testWrite('onStartup');
  await chrome.storage.local.set({ nkStartup: { ...r, at: Date.now() } });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'nk-clip-test',
    title: 'Notekind: test vault write',
    contexts: ['page', 'selection']
  });
});

chrome.contextMenus.onClicked.addListener(async info => {
  if (info.menuItemId !== 'nk-clip-test') return;
  /* A menu click IS a gesture delivered to the SW — try upgrading a
     'prompt' handle here so this clip can also mirror to disk. */
  const { handle, state } = await vaultState();
  if (handle && state === 'prompt') {
    try { await handle.requestPermission({ mode: 'readwrite' }); } catch {}
  }
  const r = await testWrite('contextmenu');
  await chrome.storage.local.set({ nkMenuTest: { ...r, at: Date.now() } });
});
