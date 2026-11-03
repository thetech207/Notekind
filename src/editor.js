/* Textarea editing behaviors, ported from Tektite: Enter continues
   lists/tasks, Tab/Shift+Tab indents, auto-pairing, and ordered-list
   auto-renumbering (renumberRange) on input. attach() wires them to a
   <textarea>; callers dispatch 'input' after programmatic edits. */

/* Renumber ordered lists so every contiguous <ol> run counts n,n+1…
   per nesting level — mirroring md.js renderListBlock's stack logic.
   Level-0 runs anchor at their first item's literal number ("2024."
   survives); nested runs restart at 1. Skips fenced code, remaps the
   selection through digit-length changes. */
export function renumberRange(ta, p0, p1) {
  const v = ta.value, lines = v.split('\n');
  const ITEM = /^(\s*)(?:([-*+])|(\d+)\.)\s+/;
  const inF = new Array(lines.length), oldLen = new Array(lines.length),
        start = new Array(lines.length);
  let off = 0, fence = false, l0 = 0, l1 = 0;
  for (let i = 0; i < lines.length; i++) {
    start[i] = off; oldLen[i] = lines[i].length; inF[i] = fence;
    if (/^\s*```/.test(lines[i])) fence = !fence;
    if (off <= p0) l0 = i;
    if (off <= p1) l1 = i;
    off += lines[i].length + 1;
  }
  const isItem = i => !inF[i] && ITEM.test(lines[i]);
  const fix = new Map(), stack = [];
  for (let i = l0; i <= l1; i++) {
    if (!isItem(i)) continue;
    let s = i, e = i;
    while (s && isItem(s - 1)) s--;
    while (e + 1 < lines.length && isItem(e + 1)) e++;
    stack.length = 0;
    for (let j = s; j <= e; j++) {
      const m = lines[j].match(ITEM);
      const ind = m[1].replace(/\t/g, '  ').length, type = m[3] ? 'ol' : 'ul';
      const open = () => stack.push({ ind, type,
        n: type === 'ol' ? (ind === 0 ? +m[3] : 1) - 1 : 0 });
      if (!stack.length || ind > stack[stack.length - 1].ind) open();
      else {
        while (stack.length && ind < stack[stack.length - 1].ind) stack.pop();
        if (stack.length && stack[stack.length - 1].type !== type) {
          stack.pop();
          open();
        }
      }
      if (!stack.length) continue;
      const n = ++stack[stack.length - 1].n;
      if (type === 'ol' && m[3] !== String(n)) {
        lines[j] = m[1] + n + lines[j].slice(m[1].length + m[3].length);
        fix.set(j, { ind: m[1].length, from: m[3].length, to: String(n).length });
      }
    }
    i = e;
  }
  if (!fix.size) return;
  /* capture before writing — assigning .value resets the caret */
  const ss = ta.selectionStart, se = ta.selectionEnd;
  ta.value = lines.join('\n');
  const remap = p => {
    let i = 0;
    while (i + 1 < lines.length && p > start[i] + oldLen[i]) i++;
    const col = p - start[i], f = fix.get(i);
    const nc = !f || col <= f.ind ? col :
               col >= f.ind + f.from ? col + f.to - f.from : f.ind + f.to;
    let base = 0;
    for (let j = 0; j < i; j++)
      base += oldLen[j] + (fix.has(j) ? fix.get(j).to - fix.get(j).from : 0) + 1;
    return base + Math.min(nc, lines[i].length);
  };
  ta.selectionStart = remap(ss);
  ta.selectionEnd = remap(se);
}

export function attach(ta) {
  /* renumber on every input (covers typing, delete, paste, undo) */
  ta.addEventListener('input', () =>
    renumberRange(ta, ta.selectionStart, ta.selectionEnd));

  /* Obsidian-style list continuation: Enter on a task/bullet line makes
     a new item; Enter on an empty item removes the marker and drops to
     a fresh line */
  ta.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;
    const s = ta.selectionStart, v = ta.value;
    if (s !== ta.selectionEnd) return;
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    const nl = v.indexOf('\n', s);
    const lineEnd = nl === -1 ? v.length : nl;
    const m = v.slice(lineStart, lineEnd)
      .match(/^(\s*)((?:[-*+])|(?:\d+\.))\s+(\[[ xX]\]\s+)?(.*)$/);
    if (!m) return;
    const [, indent, bullet, task = '', text] = m;
    const markerLen = indent.length + bullet.length + 1 + task.length;
    if (s - lineStart < markerLen) return;
    e.preventDefault();
    if (!text.trim()) {
      ta.value = v.slice(0, lineStart) + '\n' + v.slice(lineEnd);
      ta.selectionStart = ta.selectionEnd = lineStart + 1;
      /* breaking out splits the block — renumber what remains */
      renumberRange(ta, Math.max(0, lineStart - 1),
                  Math.min(ta.value.length, lineStart + 2));
    } else {
      const nb = /\d/.test(bullet) ? (parseInt(bullet) + 1) + '.' : bullet;
      const insert = '\n' + indent + nb + ' ' + (task ? '[ ] ' : '');
      ta.value = v.slice(0, s) + insert + v.slice(s);
      ta.selectionStart = ta.selectionEnd = s + insert.length;
      renumberRange(ta, ta.selectionStart, ta.selectionEnd);
    }
    ta.dispatchEvent(new Event('input'));
  });

  /* Tab / Shift+Tab indent & unindent the current line or selection */
  ta.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
    const lStart = v.lastIndexOf('\n', s - 1) + 1;
    const nl = v.indexOf('\n', en);
    const lEnd = nl === -1 ? v.length : nl;
    const lines = v.slice(lStart, lEnd).split('\n');
    if (e.shiftKey) {
      const out = lines.map(l => l.replace(/^ {1,2}/, ''));
      const total = lines.join('\n').length - out.join('\n').length;
      const first = lines[0].length - out[0].length;
      ta.value = v.slice(0, lStart) + out.join('\n') + v.slice(lEnd);
      ta.selectionStart = Math.max(lStart, s - first);
      ta.selectionEnd = Math.max(ta.selectionStart, en - total);
    } else {
      ta.value = v.slice(0, lStart) + lines.map(l => '  ' + l).join('\n') + v.slice(lEnd);
      ta.selectionStart = s + 2;
      ta.selectionEnd = en + 2 * lines.length;
    }
    renumberRange(ta, ta.selectionStart, ta.selectionEnd);
    ta.dispatchEvent(new Event('input'));
  });

  /* Auto-pairing: opener inserts closer, selection wraps, typing a
     closer types over it, Backspace removes an empty pair.
     `[` deliberately excluded (checkbox ergonomics). */
  const PAIRS = { '(': ')', '{': '}', '"': '"',
                  "'": "'", '`': '`', '*': '*', '_': '_', '~': '~' };
  ta.addEventListener('keydown', e => {
    const s = ta.selectionStart, en = ta.selectionEnd;
    const v = ta.value, prev = v[s - 1], next = v[s];
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Backspace' && s === en && PAIRS[prev] === next) {
      e.preventDefault();
      ta.value = v.slice(0, s - 1) + v.slice(s + 1);
      ta.selectionStart = ta.selectionEnd = s - 1;
      ta.dispatchEvent(new Event('input'));
      return;
    }
    if (!PAIRS[e.key]) return;

    if (s === en && next === e.key && prev !== e.key) {
      e.preventDefault();
      ta.selectionStart = ta.selectionEnd = s + 1;
      return;
    }
    if ((e.key === "'" || e.key === '"') && /\w/.test(prev || '')) return;

    e.preventDefault();
    const sel = v.slice(s, en);
    ta.value = v.slice(0, s) + e.key + sel + PAIRS[e.key] + v.slice(en);
    ta.selectionStart = s + 1;
    ta.selectionEnd = en + 1;
    ta.dispatchEvent(new Event('input'));
  });
}
