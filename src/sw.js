import { idbGet } from './idb.js';

const SPIKE_FILE = 'notekind-spike.txt';

/* Core spike: can a service worker write to a stored directory handle
   without a window and without a user gesture? Returns a result object
   describing how far it got. */
async function testWrite(source) {
  const h = await idbGet('vault');
  if (!h) return { ok: false, source, reason: 'no-handle' };
  let state = 'unknown';
  try {
    state = await h.queryPermission({ mode: 'readwrite' });
  } catch (e) {
    return { ok: false, source, reason: `queryPermission failed: ${e.message}` };
  }
  if (state !== 'granted')
    return { ok: false, source, reason: `permission-${state}`, state };
  try {
    const fh = await h.getFileHandle(SPIKE_FILE, { create: true });
    const w = await fh.createWritable();
    await w.write(`notekind write via ${source} @ ${new Date().toISOString()}\n`);
    await w.close();
    return { ok: true, source, state };
  } catch (e) {
    return { ok: false, source, reason: `write failed (${e.name}): ${e.message}`, state };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'nk-test-write') {
    testWrite('message').then(sendResponse);
    return true; /* keep channel open for async response */
  }
});

/* THE critical experiment: write to the vault at browser startup —
   no window, no gesture. If this works after a restart, silent
   background clipping is viable. Result is recorded for the app page. */
chrome.runtime.onStartup.addListener(async () => {
  const r = await testWrite('onStartup');
  await chrome.storage.local.set({ nkStartup: { ...r, at: Date.now() } });
});

/* Context-menu path: a menu click IS a user gesture delivered to the
   service worker. Tests whether SW writes work on-gesture, and whether
   requestPermission can prompt from a worker when state is 'prompt'. */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'nk-clip-test',
    title: 'Notekind: test vault write',
    contexts: ['page', 'selection']
  });
});

chrome.contextMenus.onClicked.addListener(async info => {
  if (info.menuItemId !== 'nk-clip-test') return;
  const h = await idbGet('vault');
  if (!h) {
    await chrome.storage.local.set({
      nkMenuTest: { ok: false, source: 'contextmenu', reason: 'no-handle', at: Date.now() }
    });
    return;
  }
  let state = 'unknown';
  try {
    state = await h.queryPermission({ mode: 'readwrite' });
    if (state === 'prompt') {
      /* does a permission prompt work from a worker on this gesture? */
      state = await h.requestPermission({ mode: 'readwrite' });
    }
  } catch (e) {
    const r = { ok: false, source: 'contextmenu', reason: `permission flow threw: ${e.message}`, state };
    await chrome.storage.local.set({ nkMenuTest: { ...r, at: Date.now() } });
    return;
  }
  const r = await testWrite('contextmenu');
  await chrome.storage.local.set({ nkMenuTest: { ...r, at: Date.now() } });
});
