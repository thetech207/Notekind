import { writeNote, vaultState } from './store.js';

const pad = n => String(n).padStart(2, '0');
const slug = t => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 50) || 'clip';

/* Write a clip note: IDB always succeeds silently; mirrors to .md in
   the vault when its permission is 'granted' this session. */
async function clipWrite(source, title, url, body) {
  try {
    const d = new Date();
    const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      ` ${pad(d.getHours())}${pad(d.getMinutes())} ${slug(title)}.md`;
    const path = 'clips/' + name;
    const text = `# ${title}\n> Source: ${url} — clipped ${d.toLocaleString()}\n\n${body}\n`;
    const r = await writeNote(path, text);
    return { ok: true, source, path, mirrored: r.mirrored };
  } catch (e) {
    return { ok: false, source, reason: `${e.name}: ${e.message}` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'nk-test-write') {
    clipWrite('message', 'spike', '', `notekind write via message @ ${new Date().toISOString()}`)
      .then(sendResponse);
    return true;
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const { state } = await vaultState();
  await chrome.storage.local.set({
    nkStartup: { ok: true, source: 'onStartup', vault: state, at: Date.now() }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'nk-clip-page',
    title: 'Clip page to Notekind',
    contexts: ['page']
  });
  chrome.contextMenus.create({
    id: 'nk-clip-sel',
    title: 'Clip selection to Notekind',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'nk-clip-page' && info.menuItemId !== 'nk-clip-sel') return;
  let res;
  try {
    /* a menu click grants activeTab for this tab — inject and extract */
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/clip.js']
    });
    const c = r?.result;
    res = c?.md
      ? await clipWrite(info.menuItemId, c.title, c.url, c.md)
      : await clipWrite(info.menuItemId, c?.title || tab?.title || 'clip',
          c?.url || info.pageUrl || '',
          '> *(nothing readable captured — link clip only)*');
  } catch (e) {
    /* injection blocked (chrome://, Web Store, CSP edge) → link-only clip */
    res = await clipWrite(info.menuItemId, tab?.title || 'clip',
      info.pageUrl || '',
      `> *(could not extract page: ${e.message} — link clip only)*`);
  }
  await chrome.storage.local.set({ nkClip: { ...res, at: Date.now() } });
});
