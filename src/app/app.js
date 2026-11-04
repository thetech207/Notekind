import { idbGet, idbSet, idbDel, dbAll, STORES } from '../idb.js';
import { writeNote, readNote, listNotes, deleteNote, vaultState, mirrorAll,
         importVault, exportZip, getBlob, putBlob } from '../store.js';
import { md, EMOJI } from '../md.js';
import { dayPath, dayLabel, isDateName, dateNamePath, MONTHS, pad } from '../dates.js';
import { attach } from '../editor.js';

const $ = id => document.getElementById(id);
const ta = $('editor');
const VAULT_KEY = 'vault';

let curPath = null, saveTimer = null;
let tabs = [], curTab = -1;
let noteIndex = new Map();   // basename lowercase, no .md → path
const imgUrls = [];

const log = m => { const l = $('log'); if (l) l.textContent += `[${new Date().toLocaleTimeString()}] ${m}\n`; };
const setStatus = s => { $('status').textContent = s; };

/* ---------- notes ---------- */

async function rebuildIndex() {
  const notes = await listNotes();
  noteIndex = new Map();
  for (const n of notes) {
    const base = n.path.split('/').pop().replace(/\.md$/i, '').toLowerCase();
    if (!noteIndex.has(base)) noteIndex.set(base, n.path);
  }
  return notes;
}

async function openNote(path, create, newTab) {
  await flushSave();
  let rec = await readNote(path);
  if (!rec) {
    if (create === undefined || create === false) return;
    const text = isDateName(path.split('/').pop().replace(/\.md$/, ''))
      ? '# ' + dayLabel(new Date(path.split('/').pop().replace(/\.md$/, '') + 'T12:00:00')) + '\n\n'
      : '';
    await writeNote(path, text);
    rec = { path, text };
    await refreshTree();
  }
  curPath = path;
  if (newTab || !tabs.length) { tabs.push({ path }); curTab = tabs.length - 1; }
  else tabs[curTab].path = path;
  persistTabs();
  renderTabs();
  $('empty').hidden = true;
  ta.hidden = true;
  $('preview').hidden = false;
  revealPath(path);
  ta.value = rec.text;
  $('notePath').textContent = path;
  idbSet('lastPath', path);
  renderPreview();
  markTreeCur();
  setStatus('');
  ta.focus();
}

function save() {
  if (!curPath) return;
  writeNote(curPath, ta.value).then(r => {
    setStatus(r.mirrored ? 'Saved · synced' : 'Saved');
  });
}
function flushSave() {
  clearTimeout(saveTimer);
  return curPath ? writeNote(curPath, ta.value).then(() => {}) : Promise.resolve();
}

async function openDay(d, newTab) {
  const p = dayPath(d);
  if (!(await readNote(p)))
    await writeNote(p, '# ' + dayLabel(d) + '\n\n');
  await refreshTree();
  await openNote(p, true, newTab);
}

/* ---------- tabs ---------- */

function persistTabs() {
  idbSet('openTabs', tabs.map(t => t.path));
  idbSet('curTab', curTab);
}

function renderTabs() {
  const el = $('tabs');
  el.textContent = '';
  tabs.forEach((t, i) => {
    const d = document.createElement('div');
    d.className = 'tab' + (i === curTab ? ' cur' : '');
    d.title = t.path;
    const base = t.path.split('/').pop().replace(/\.md$/, '');
    d.textContent = isDateName(base) ? dayLabel(new Date(base + 'T12:00:00')) : base;
    d.onclick = () => switchTab(i);
    const x = document.createElement('button');
    x.className = 'x'; x.textContent = '✕';
    x.onclick = e => { e.stopPropagation(); closeTab(i); };
    d.appendChild(x);
    el.appendChild(d);
  });
}

async function switchTab(i) {
  if (i === curTab || !tabs[i]) return;
  await flushSave();
  curTab = i;
  persistTabs();
  await openNote(tabs[i].path);
}

async function closeTab(i) {
  const wasCur = i === curTab;
  tabs.splice(i, 1);
  if (i < curTab) curTab--;
  else if (wasCur) curTab = Math.min(i, tabs.length - 1);
  if (!tabs.length) {
    curTab = -1;
    persistTabs(); renderTabs();
    return openDay(new Date());
  }
  persistTabs(); renderTabs();
  if (wasCur) await openNote(tabs[curTab].path);
}

/* Remove a path from open tabs before deleting/moving it — otherwise
   the pending autosave rewrites curPath and resurrects the note. */
async function dropTabsWithPath(path) {
  clearTimeout(saveTimer);
  const wasCur = curPath === path;
  tabs = tabs.filter(t => t.path !== path);
  if (curTab >= tabs.length) curTab = tabs.length - 1;
  persistTabs(); renderTabs();
  if (!tabs.length) {
    curPath = null;
    $('empty').hidden = false;
    ta.hidden = true;
    $('preview').hidden = true;
    $('notePath').textContent = '';
    return;
  }
  if (wasCur) await openNote(tabs[curTab].path);
}

/* ---------- tree ---------- */

function nest(paths) {
  const root = { dirs: new Map(), files: [] };
  for (const p of paths) {
    const segs = p.split('/');
    let node = root;
    for (const s of segs.slice(0, -1)) {
      if (!node.dirs.has(s)) node.dirs.set(s, { dirs: new Map(), files: [] });
      node = node.dirs.get(s);
    }
    node.files.push(p);
  }
  return root;
}

const openDirs = new Set(JSON.parse(localStorage.getItem('nk-tree-open') || '[]'));
function persistDirs() {
  localStorage.setItem('nk-tree-open', JSON.stringify([...openDirs]));
}

function renderNode(node, prefix, depth, el) {
  for (const [name, sub] of [...node.dirs].sort()) {
    const path = prefix + name;
    const open = openDirs.has(path);
    const d = document.createElement('div');
    d.className = 'dir' + (open ? ' open' : '');
    d.style.paddingLeft = 6 + depth * 14 + 'px';
    d.textContent = name;
    d.onclick = () => {
      open ? openDirs.delete(path) : openDirs.add(path);
      persistDirs();
      refreshTree();
    };
    el.appendChild(d);
    if (open) renderNode(sub, path + '/', depth + 1, el);
  }
  for (const p of node.files.sort()) {
    const f = document.createElement('div');
    f.className = 'file' + (p === curPath ? ' cur' : '');
    f.style.paddingLeft = 18 + depth * 14 + 'px';
    const base = p.split('/').pop().replace(/\.md$/, '');
    if (isDateName(base)) {
      const d = new Date(base + 'T12:00:00');
      f.textContent = dayLabel(d);
    } else f.textContent = base;
    f.title = p;
    f.onclick = e => openNote(p, undefined, e.ctrlKey || e.metaKey);
    f.onauxclick = e => { if (e.button === 1) openNote(p, undefined, true); };
    f.oncontextmenu = e => { e.preventDefault(); showCtx(e, p, false); };
    el.appendChild(f);
  }
}

async function refreshTree() {
  const notes = await rebuildIndex();
  const tree = $('tree');
  tree.textContent = '';
  const shown = notes.map(n => n.path).filter(p => !p.startsWith('.'));
  renderNode(nest(shown), '', 0, tree);
  /* trash section: notes under .trash/ get Restore/Purge ops */
  const trashed = notes.map(n => n.path).filter(p => p.startsWith('.trash/'));
  if (trashed.length) {
    const t = document.createElement('div');
    t.className = 'dir' + (openDirs.has('.trash') ? ' open' : '');
    t.textContent = '🗑 Trash (' + trashed.length + ')';
    t.onclick = () => {
      openDirs.has('.trash') ? openDirs.delete('.trash') : openDirs.add('.trash');
      persistDirs(); refreshTree();
    };
    tree.appendChild(t);
    if (openDirs.has('.trash'))
      for (const p of trashed.sort()) {
        const f = document.createElement('div');
        f.className = 'file';
        f.style.paddingLeft = '18px';
        f.textContent = p.slice(7).split('/').pop().replace(/\.md$/, '');
        f.title = p;
        f.onclick = () => openNote(p);
        f.oncontextmenu = e => { e.preventDefault(); showCtx(e, p, true); };
        tree.appendChild(f);
      }
  }
  renderCal(notes);
}

/* ---------- tree context menu ---------- */

function showCtx(e, path, trashed) {
  const m = $('ctxMenu');
  m.innerHTML = '';
  const item = (label, fn, danger) => {
    const d = document.createElement('div');
    d.className = 'mi' + (danger ? ' danger' : '');
    d.textContent = label;
    d.onclick = async () => {
      /* destructive items arm on first click — confirm()/prompt() are
         unreliable on extension pages in some Chromium builds */
      if (danger && !d.dataset.armed) {
        d.dataset.armed = '1';
        d.textContent = 'Sure? Click again';
        return;
      }
      m.hidden = true;
      try { await fn(); } catch (e) { log(`failed: ${e.message}`); }
    };
    m.appendChild(d);
  };
  item('Open in new tab', () => openNote(path, true, true));
  if (!trashed) {
    item('Rename…', async () => {
      const nn = prompt('New path:', path);
      if (!nn || nn === path) return;
      const rec = await readNote(path);
      if (!rec) return;
      const np = nn.endsWith('.md') ? nn : nn + '.md';
      clearTimeout(saveTimer);
      await writeNote(np, rec.text);
      await deleteNote(path);
      for (const t of tabs) if (t.path === path) t.path = np;
      if (curPath === path) curPath = np;
      persistTabs(); renderTabs();
      await refreshTree();
    });
    item('Move to trash', async () => {
      const rec = await readNote(path);
      if (!rec) return;
      await dropTabsWithPath(path);
      await writeNote('.trash/' + path, rec.text, { mirror: false });
      await deleteNote(path);
      await refreshTree();
    }, true);
  } else {
    item('Restore', async () => {
      const rec = await readNote(path);
      if (!rec) return;
      await writeNote(path.slice(7), rec.text);
      await deleteNote(path);
      await refreshTree();
    });
    item('Delete forever', async () => {
      await dropTabsWithPath(path);
      await deleteNote(path);
      await refreshTree();
    }, true);
  }
  m.style.left = Math.min(e.clientX, innerWidth - 180) + 'px';
  m.style.top = Math.min(e.clientY, innerHeight - 160) + 'px';
  m.hidden = false;
}
document.addEventListener('click', e => {
  if (!e.target.closest('#ctxMenu')) $('ctxMenu').hidden = true;
});

/* ---------- calendar ---------- */

const _now = new Date();
let calY = _now.getFullYear(), calM = _now.getMonth();

function renderCal(notes) {
  const dates = new Set(notes
    .map(n => n.path.split('/').pop().replace(/\.md$/, ''))
    .filter(isDateName));
  const startDay = new Date(calY, calM, 1).getDay();
  const daysIn = new Date(calY, calM + 1, 0).getDate();
  const todayStr = dayPath(new Date()).split('/').pop().replace('.md', '');
  let html = `<div id="calHead"><button id="calPrev" class="ghost">‹</button>` +
    `<span>${MONTHS[calM]} ${calY}</span><button id="calNext" class="ghost">›</button></div>` +
    '<div id="calGrid">';
  for (const w of 'SMTWTFS') html += `<span class="wd">${w}</span>`;
  for (let i = 0; i < startDay; i++) html += '<span></span>';
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${calY}-${pad(calM + 1)}-${pad(d)}`;
    html += `<span class="day${ds === todayStr ? ' today' : ''}` +
      `${dates.has(ds) ? ' has' : ''}" data-d="${ds}">${d}</span>`;
  }
  html += '</div>';
  $('calWrap').innerHTML = html;
  $('calPrev').onclick = () => { if (--calM < 0) { calM = 11; calY--; } renderCal(notes); };
  $('calNext').onclick = () => { if (++calM > 11) { calM = 0; calY++; } renderCal(notes); };
  $('calGrid').querySelectorAll('.day').forEach(el =>
    el.onclick = () => openDay(new Date(el.dataset.d + 'T12:00:00'), true));
}
function markTreeCur() {
  document.querySelectorAll('#tree .file').forEach(f =>
    f.classList.toggle('cur', f.title === curPath));
}

/* ---------- preview ---------- */

function renderPreview() {
  const pv = $('preview');
  pv.innerHTML = md(ta.value);
  for (const u of imgUrls) URL.revokeObjectURL(u);
  imgUrls.length = 0;
  pv.querySelectorAll('img[data-vault]').forEach(async img => {
    const name = img.dataset.vault;
    const rec = await getBlob(name.includes('/') ? name : `attachments/${name}`);
    if (rec?.blob) {
      const u = URL.createObjectURL(rec.blob);
      imgUrls.push(u);
      img.src = u;
    }
  });
}

$('preview').addEventListener('click', async e => {
  const a = e.target.closest('a.wikilink');
  if (a) {
    e.preventDefault();
    const name = a.dataset.wiki;
    const key = name.toLowerCase();
    let path = noteIndex.get(key);
    if (!path)
      path = isDateName(name) ? dateNamePath(name) : name + '.md';
    await openNote(path, true);
    return;
  }
  const cb = e.target.closest('input[type=checkbox][data-t]');
  if (cb) {
    /* flip the nth task marker in the source */
    const want = +cb.dataset.t;
    let n = -1;
    ta.value = ta.value.split('\n').map(l => {
      const m = l.match(/^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/);
      if (m && ++n === want)
        return l.slice(0, m[1].length) + '[' + (cb.checked ? 'x' : ' ') + ']' +
               l.slice(m[0].length);
      return l;
    }).join('\n');
    ta.dispatchEvent(new Event('input'));
  }
});

/* ---------- vault bar / debug ---------- */

async function refreshVault() {
  const { handle, state } = await vaultState();
  $('vaultBar').innerHTML = handle
    ? `<b>${handle.name}</b> — ` +
      (state === 'granted'
        ? '<span class="ok">syncing</span>'
        : `<a id="vSync">enable sync</a>`)
    : `<a id="vPick">link a vault folder</a> for .md sync`;
  if ($('vSync')) $('vSync').onclick = enableSync;
  if ($('vPick')) $('vPick').onclick = pickVault;
}

async function pickVault() {
  try {
    const h = await showDirectoryPicker({ mode: 'readwrite' });
    if (await h.requestPermission({ mode: 'readwrite' }) !== 'granted') return;
    await idbSet(VAULT_KEY, h);
    log(`vault saved: ${h.name}`);
    refreshVault();
  } catch (e) { if (e.name !== 'AbortError') log(`pick failed: ${e.message}`); }
}

async function enableSync() {
  const h = await idbGet(VAULT_KEY);
  if (!h) return pickVault();
  if (await h.requestPermission({ mode: 'readwrite' }) === 'granted') {
    log(`mirrored ${await mirrorAll(h)} item(s)`);
  }
  refreshVault();
}

/* ---------- wiring ---------- */

attach(ta);

/* paste/drop files → attachments/<name> blob + ![[name]] embed.
   Only handles real File items — a clipboard holding a path as text
   can't be imported (browsers can't read arbitrary disk paths). */
function insertAtCursor(text) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + text.length;
  ta.dispatchEvent(new Event('input'));
}

async function importFiles(files) {
  for (const f of files) {
    let name = f.name || `pasted-${Date.now()}`;
    let p = `attachments/${name}`, i = 1;
    while (await getBlob(p)) {
      const m = name.match(/^(.*?)(\.[^.]*)?$/);
      p = `attachments/${m[1]} ${i++}${m[2] || ''}`;
    }
    await putBlob(p, f);
    insertAtCursor(`![[${p.split('/').pop()}]]`);
    setStatus(`Imported ${p}`);
  }
}

ta.addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  importFiles(files);
});
ta.addEventListener('dragover', e => e.preventDefault());
ta.addEventListener('drop', e => {
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  importFiles(files);
});

ta.addEventListener('input', () => {
  setStatus('Unsaved…');
  if (!$('preview').hidden) renderPreview();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
});

$('prevBtn').onclick = () => {
  const pv = $('preview');
  if (pv.hidden) { renderPreview(); pv.hidden = false; ta.hidden = true; }
  else { pv.hidden = true; ta.hidden = false; ta.focus(); }
};

$('today').onclick = () => openDay(new Date());

$('newNote').onclick = async () => {
  const name = prompt('Note name (e.g. projects/idea):');
  if (!name) return;
  const p = name.endsWith('.md') ? name : name + '.md';
  if (await readNote(p)) return openNote(p);
  await writeNote(p, '# ' + p.split('/').pop().replace(/\.md$/, '') + '\n\n');
  await refreshTree();
  await openNote(p);
};

$('pick').onclick = pickVault;
$('sync').onclick = enableSync;
$('import').onclick = async () => {
  const h = await idbGet(VAULT_KEY);
  if (!h) return log('no vault selected');
  if (await h.requestPermission({ mode: 'readwrite' }) !== 'granted')
    return log('import needs permission');
  log(`imported ${await importVault(h)} file(s)`);
  refreshTree(); refreshVault();
};
$('export').onclick = async () => {
  const blob = await exportZip();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'notekind-vault.zip';
  a.click();
  URL.revokeObjectURL(a.href);
  log(`exported ${(blob.size / 1024).toFixed(1)}KB zip`);
};
$('forget').onclick = async () => {
  await idbDel(VAULT_KEY);
  log('handle forgotten — vault files untouched');
  refreshVault();
};

/* ---------- quick open ---------- */

let qItems = [], qHits = [], qSel = 0;

async function openQuick() {
  qItems = (await listNotes()).map(n => n.path).sort();
  qSel = 0;
  $('quick').hidden = false;
  $('qInput').value = '';
  renderQuick('');
  $('qInput').focus();
}
function closeQuick() { $('quick').hidden = true; ta.focus(); }

function renderQuick(q) {
  const ql = q.toLowerCase();
  qHits = qItems.filter(p => p.toLowerCase().includes(ql)).slice(0, 30);
  qSel = Math.min(qSel, Math.max(qHits.length - 1, 0));
  const el = $('qList');
  el.textContent = '';
  if (!qHits.length) {
    el.innerHTML = '<div class="none">no notes match</div>';
    return;
  }
  qHits.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'q' + (i === qSel ? ' sel' : '');
    const base = p.split('/').pop().replace(/\.md$/, '');
    const label = isDateName(base) ? dayLabel(new Date(base + 'T12:00:00')) : base;
    d.innerHTML = `${label}<span class="p">${p}</span>`;
    d.onclick = () => { closeQuick(); openNote(p); };
    el.appendChild(d);
  });
}

$('qInput').addEventListener('input', () => { qSel = 0; renderQuick($('qInput').value); });
$('qInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); closeQuick(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); qSel = Math.min(qSel + 1, qHits.length - 1); renderQuick($('qInput').value); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); qSel = Math.max(qSel - 1, 0); renderQuick($('qInput').value); }
  else if (e.key === 'Enter' && qHits[qSel]) {
    e.preventDefault();
    const p = qHits[qSel];
    closeQuick();
    openNote(p, undefined, e.ctrlKey || e.metaKey);
  }
});
$('quick').addEventListener('click', e => { if (e.target === $('quick')) closeQuick(); });
$('quickBtn').onclick = openQuick;
$('newTab').onclick = () => openDay(new Date(), true);

/* ---------- full-text search (Ctrl+Shift+F) ---------- */

function openSearch() {
  $('search').hidden = false;
  $('sInput').value = '';
  $('sList').innerHTML = '<div class="none">type to search note contents</div>';
  $('sInput').focus();
}
function closeSearch() { $('search').hidden = true; ta.focus(); }

const escHtml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
let sTimer = null;
$('sInput').addEventListener('input', () => {
  clearTimeout(sTimer);
  sTimer = setTimeout(renderSearch, 150);
});
async function renderSearch() {
  const q = $('sInput').value.trim();
  const el = $('sList');
  if (q.length < 2) { el.innerHTML = '<div class="none">type to search note contents</div>'; return; }
  const ql = q.toLowerCase();
  const notes = await dbAll(STORES.notes);
  const rows = [];
  for (const n of notes) {
    if (n.path.startsWith('.trash/')) continue;
    const hits = [];
    for (const line of n.text.split('\n')) {
      const i = line.toLowerCase().indexOf(ql);
      if (i !== -1) {
        hits.push(escHtml(line.slice(Math.max(0, i - 30), i + q.length + 50))
          .replace(new RegExp(escHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                   m => `<mark>${m}</mark>`));
        if (hits.length >= 3) break;
      }
    }
    if (hits.length) rows.push({ path: n.path, hits });
  }
  el.textContent = '';
  if (!rows.length) { el.innerHTML = '<div class="none">no matches</div>'; return; }
  for (const r of rows) {
    const d = document.createElement('div');
    d.className = 's';
    const base = r.path.split('/').pop().replace(/\.md$/, '');
    const label = isDateName(base) ? dayLabel(new Date(base + 'T12:00:00')) : base;
    d.innerHTML = `<span class="n">${escHtml(label)}</span>` +
      r.hits.map(h => `<span class="sn">…${h}…</span>`).join('');
    d.onclick = () => { closeSearch(); openNote(r.path); };
    el.appendChild(d);
  }
}
$('sInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
});
$('search').addEventListener('click', e => { if (e.target === $('search')) closeSearch(); });
$('searchBtn').onclick = openSearch;

/* ---------- emoji popup ---------- */

const emEl = $('emoji');
let emList = [], emSel = 0, emFrom = 0;

/* caret pixel position in the textarea via a mirror div */
function caretXY() {
  const cs = getComputedStyle(ta);
  const d = document.createElement('div');
  for (const p of ['fontFamily','fontSize','lineHeight','letterSpacing',
      'paddingTop','paddingRight','paddingBottom','paddingLeft','boxSizing'])
    d.style[p] = cs[p];
  const r = ta.getBoundingClientRect();
  d.style.cssText += ';position:fixed;visibility:hidden;white-space:pre-wrap;' +
    `overflow-wrap:break-word;width:${r.width}px;left:${r.left}px;top:${r.top}px;`;
  d.textContent = ta.value.slice(0, ta.selectionStart);
  const mk = document.createElement('span');
  mk.textContent = 'x';
  d.appendChild(mk);
  document.body.appendChild(d);
  const pos = { x: r.left + mk.offsetLeft - ta.scrollLeft,
                y: r.top + mk.offsetTop - ta.scrollTop };
  d.remove();
  return pos;
}

function emClose() { emEl.hidden = true; emList = []; }
function emCheck() {
  const m = ta.value.slice(0, ta.selectionStart).match(/:([a-z_]*)$/);
  if (!m) return emClose();
  emList = Object.keys(EMOJI).filter(k => k.startsWith(m[1])).slice(0, 8);
  if (!emList.length) return emClose();
  emSel = 0; emFrom = m[1].length;
  emEl.innerHTML = '';
  emList.forEach((k, i) => {
    const d = document.createElement('div');
    d.className = 'em' + (i === emSel ? ' sel' : '');
    d.innerHTML = `${EMOJI[k]}<span class="n">${k}</span>`;
    d.onclick = () => emPick(i);
    emEl.appendChild(d);
  });
  const p = caretXY();
  emEl.style.left = Math.min(p.x, innerWidth - 140) + 'px';
  emEl.style.top = (p.y + 22) + 'px';
  emEl.hidden = false;
}
function emPick(i) {
  const name = emList[i ?? emSel];
  const ins = ':' + name + ':';
  const start = ta.selectionStart - emFrom - 1; /* consume the ':' too */
  ta.value = ta.value.slice(0, start) + ins + ta.value.slice(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = start + ins.length;
  emClose();
  ta.dispatchEvent(new Event('input'));
}
ta.addEventListener('input', emCheck);
ta.addEventListener('keydown', e => {
  if (emEl.hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); emClose(); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Tab') {
    e.preventDefault(); emSel = (emSel + 1) % emList.length;
    emEl.querySelectorAll('.em').forEach((d, i) => d.classList.toggle('sel', i === emSel));
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault(); emSel = (emSel + emList.length - 1) % emList.length;
    emEl.querySelectorAll('.em').forEach((d, i) => d.classList.toggle('sel', i === emSel));
  } else if (e.key === 'Enter') { e.preventDefault(); emPick(); }
});
document.addEventListener('click', e => { if (!e.target.closest('#emoji') && e.target !== ta) emClose(); });

/* ---------- print ---------- */

$('printBtn').onclick = () => {
  const pv = $('preview');
  const wasHidden = pv.hidden;
  if (wasHidden) { renderPreview(); pv.hidden = false; ta.hidden = true; }
  setTimeout(() => {
    window.print();
    if (wasHidden) { pv.hidden = true; ta.hidden = false; }
  }, 50);
};

/* ---------- global shortcuts ---------- */

document.addEventListener('keydown', e => {
  if (!$('quick').hidden || !$('search').hidden) return;   /* modal owns keys */
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') {
    e.preventDefault(); openSearch(); return;
  }
  /* Ctrl+E is browser-reserved (omnibox) — page may never see it;
     Alt+P is the reliable fallback. Same for Ctrl+P vs Alt+O. */
  if ((e.ctrlKey && e.code === 'KeyE') || (e.altKey && e.code === 'KeyP')) {
    e.preventDefault(); $('prevBtn').click();
  } else if ((e.ctrlKey && e.code === 'KeyP') || (e.altKey && e.code === 'KeyO')) {
    e.preventDefault(); openQuick();
  } else if (e.ctrlKey && e.code === 'KeyS') {
    e.preventDefault(); flushSave().then(() => setStatus('Saved'));
  }
});

/* clip results land in storage — log them and refresh the tree */
chrome.storage.onChanged.addListener(ch => {
  if (!ch.nkClip) return;
  const c = ch.nkClip.newValue;
  log(c.ok ? `clip → ${c.path}${c.mirrored ? ' (synced)' : ''}`
           : `clip failed: ${c.reason}`);
  if (c.ok) revealPath(c.path);
  refreshTree();
  if (ch.nkBackup) {
    const b = ch.nkBackup.newValue;
    log(b.ok ? `backup → ${b.name} (${b.via})` : `backup failed: ${b.reason}`);
  }
});

/* expand all ancestor dirs of a path so its file is visible */
function revealPath(path) {
  const segs = path.split('/');
  for (let i = 1; i < segs.length; i++)
    openDirs.add(segs.slice(0, i).join('/'));
  persistDirs();
}

/* ---------- boot ---------- */

(async () => {
  /* new-tab gate: the manifest override can't be disabled at runtime,
     so honor the setting here — off means a minimal splash */
  if ((await idbGet('openOnNewTab')) === false) {
    document.body.innerHTML =
      '<div style="margin:25vh auto;max-width:360px;text-align:center;color:var(--dim)">' +
      '<div style="font-size:40px">&#x1F4A1;</div>' +
      '<p><a id="re" href="#" style="color:var(--accent)">Open Notekind</a></p></div>';
    $('re').onclick = async e => {
      e.preventDefault();
      await idbSet('openOnNewTab', true);
      location.reload();
    };
    return;
  }
  const cb = $('setNewTab');
  cb.checked = true;
  cb.onchange = () => idbSet('openOnNewTab', cb.checked);
  const bb = $('setBackup');
  bb.checked = (await idbGet('backupEnabled')) !== false;
  bb.onchange = () => idbSet('backupEnabled', bb.checked);
  await refreshTree();
  await refreshVault();
  const saved = (await idbGet('openTabs')) || [];
  const savedCur = (await idbGet('curTab')) || 0;
  for (const p of saved)
    if (await readNote(p)) tabs.push({ path: p });
  curTab = Math.min(savedCur, Math.max(tabs.length - 1, 0));
  if (tabs.length) await openNote(tabs[curTab].path);
  else {
    /* no auto-create — open today's note only if it already exists,
       else show the empty state until the user acts */
    const p = dayPath(new Date());
    if (await readNote(p)) await openNote(p, true);
    else {
      $('empty').hidden = false;
      ta.hidden = true;
      $('preview').hidden = true;
      renderTabs();
    }
  }
})();
