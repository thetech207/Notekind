import { idbGet } from './idb.js';
import { writeNote, vaultState, exportZip, mirrorWrite, putBlob } from './store.js';

const pad = n => String(n).padStart(2, '0');
const slug = t => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 50) || 'clip';

/* Write a clip note: IDB always succeeds silently; mirrors to .md in
   the vault when its permission is 'granted' this session. */
async function clipWrite(source, title, url, body, meta = {}) {
  try {
    const d = new Date();
    const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      ` ${pad(d.getHours())}${pad(d.getMinutes())} ${slug(title)}.md`;
    const path = 'clips/' + name;
    const text = `# ${title}\n> Source: ${url} — clipped ${d.toLocaleString()}` +
      (meta.byline ? `\n> ${meta.byline}` : '') +
      (meta.excerpt ? `\n> ${meta.excerpt}` : '') +
      `\n\n${body}\n`;
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
  /* catch up on a missed daily backup */
  const { nkBackup } = await chrome.storage.local.get('nkBackup');
  if (!nkBackup || Date.now() - nkBackup.at > 23 * 3600e3) runBackup();
});

/* ---------- scheduled backup (daily alarm) ---------- */

const BACKUP_ALARM = 'nk-backup';

chrome.alarms.onAlarm.addListener(a => {
  if (a.name === BACKUP_ALARM) runBackup();
});

/* Zip → vault/backups/ when synced; else Downloads via a data URL
   (capped — data-URL downloads truncate around ~2MB). */
async function runBackup() {
  const res = { at: Date.now() };
  try {
    if ((await idbGet('backupEnabled')) === false) return;
    const zip = await exportZip();
    const d = new Date();
    const name = `notekind-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.zip`;
    const { handle, state } = await vaultState();
    if (handle && state === 'granted') {
      await mirrorWrite(handle, 'backups/' + name, zip);
      Object.assign(res, { ok: true, via: 'vault', name });
    } else if (zip.size < 1_400_000) {
      const buf = new Uint8Array(await zip.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000)
        bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      await chrome.downloads.download({
        url: 'data:application/zip;base64,' + btoa(bin),
        filename: name, saveAs: false });
      Object.assign(res, { ok: true, via: 'downloads', name });
    } else {
      Object.assign(res, { ok: false,
        reason: `zip ${(zip.size / 1e6).toFixed(1)}MB too large — enable vault sync` });
    }
  } catch (e) {
    Object.assign(res, { ok: false, reason: `${e.name}: ${e.message}` });
  }
  await chrome.storage.local.set({ nkBackup: res });
}

/* toolbar button → open the app in a new tab */
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/app/index.html') });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(BACKUP_ALARM, { periodInMinutes: 1440 });
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

/* Download page images into attachments/ when fetchable — activeTab
   only covers the tab's origin, so cross-origin images keep their URL. */
async function embedClipImages(md, slugBase) {
  const imgs = [...md.matchAll(/!\[([^\]]*)\]\((https?:[^)\s]+)[^)]*\)/g)].slice(0, 10);
  let i = 0;
  for (const m of imgs) {
    try {
      const resp = await fetch(m[2]);
      if (!resp.ok) continue;
      const blob = await resp.blob();
      if (!blob.type.startsWith('image/') || blob.size > 5e6) continue;
      const ext = blob.type.split('/')[1].replace('jpeg', 'jpg').split('+')[0] || 'png';
      const name = `${slugBase}-img${++i}.${ext}`;
      await putBlob('attachments/' + name, blob);
      md = md.split(m[0]).join(`![[${name}]]`);
    } catch { /* cross-origin etc — keep the URL */ }
  }
  return md;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'nk-clip-page' && info.menuItemId !== 'nk-clip-sel') return;
  let res;
  try {
    /* a menu click grants activeTab for this tab — inject and extract */
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/vendor/Readability.js', 'src/vendor/turndown.js',
              'src/vendor/turndown-plugin-gfm.js', 'src/clip.js']
    });
    const c = r?.result;
    res = c?.md
      ? await clipWrite(info.menuItemId, c.title, c.url,
          await embedClipImages(c.md, slug(c.title)),
          { byline: c.byline, excerpt: c.excerpt })
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
