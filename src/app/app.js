import { idbGet, idbSet, idbDel } from '../idb.js';
import { writeNote, readNote, listNotes, vaultState, mirrorAll,
         importVault, exportZip, getBlob, putBlob } from '../store.js';
import { md } from '../md.js';
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
    el.appendChild(f);
  }
}

async function refreshTree() {
  const notes = await rebuildIndex();
  const tree = $('tree');
  tree.textContent = '';
  renderNode(nest(notes.map(n => n.path)), '', 0, tree);
  renderCal(notes);
}

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

/* ---------- global shortcuts ---------- */

document.addEventListener('keydown', e => {
  if (!$('quick').hidden) return;   /* modal owns keys while open */
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

/* ---------- boot ---------- */

(async () => {
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
