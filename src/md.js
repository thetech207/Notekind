/* Hand-rolled Markdown subset, ported from Tektite: headings, lists
   (incl. tasks + nesting), quotes, code, tables, ==highlight==,
   [[wiki]], ![[img]]. YAML frontmatter is skipped. Ordered lists honor
   <ol start> so rendered numbers match the source. */

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const EMOJI = {
  star: '⭐', fire: '🔥', alarm: '⏰',
  calendar: '📅', email: '✉️', phone: '📞',
  car: '🚗', pin: '📍', home: '🏠', money: '💰'
};

function inline(s) {
  s = esc(s);
  /* ![[img|WxH]] — |300 = width, |x200 = height, |300x200 = both;
     one dimension alone keeps aspect ratio */
  s = s.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, t, spec) => {
    const sz = spec && spec.match(/^(\d*)x?(\d*)$/);
    const style = sz && (sz[1] || sz[2])
      ? ` style="${sz[1] ? `width:${sz[1]}px` : ''}${sz[1] && sz[2] ? ';' : ''}${sz[2] ? `height:${sz[2]}px` : ''}"`
      : '';
    return `<img data-vault="${t}"${style}>`;
  });
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) =>
    /^(https?|data|blob):/.test(src)
      ? `<img alt="${alt}" src="${src}">`
      : `<img alt="${alt}" data-vault="${src}">`);
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (m, t, d) => `<a href="#" class="wikilink" data-wiki="${t}">${d || t}</a>`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  s = s.replace(/:([a-z_]+):/g, (m, n) => EMOJI[n] || m);
  return s;
}

const isSpecial = l =>
  /^(```|#{1,6}\s|>\s?|\s*(?:[-*+]|\d+\.)\s+|\s*(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(l);

function renderListBlock(items) {
  let html = '', stack = [];
  const open = it => `<${it.type}` +
    (it.type === 'ol' && it.num !== 1 ? ` start="${it.num}"` : '') + '>';
  for (const it of items) {
    if (!stack.length || it.indent > stack[stack.length - 1].indent) {
      html += open(it);
      stack.push({ indent: it.indent, type: it.type });
    } else {
      while (stack.length && it.indent < stack[stack.length - 1].indent)
        html += `</${stack.pop().type}>`;
      if (stack.length && stack[stack.length - 1].type !== it.type) {
        html += `</${stack.pop().type}>${open(it)}`;
        stack.push({ indent: it.indent, type: it.type });
      }
    }
    html += it.task
      ? `<li class="task"><input type="checkbox" data-t="${it.tIdx}"${it.checked ? ' checked' : ''}> ${inline(it.text)}</li>`
      : `<li>${inline(it.text)}</li>`;
  }
  while (stack.length) html += `</${stack.pop().type}>`;
  return html;
}

export function md(src) {
  const lines = src.split('\n');
  let html = '', i = 0, taskNo = 0;
  /* hide YAML frontmatter */
  if (lines[0] === '---') {
    let j = 1;
    while (j < lines.length && !/^---\s*$/.test(lines[j])) j++;
    if (j < lines.length) i = j + 1;
  }
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^```/.test(line.trim())) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]);
      i++;
      html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; i++; continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { html += '<hr>'; i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      html += `<blockquote>${md(buf.join('\n'))}</blockquote>`;
      continue;
    }
    /* pipe table: header row + |---| separator row */
    if (/^\s*\|/.test(line) && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) &&
        lines[i + 1].includes('-')) {
      const cells = l => l.trim().replace(/^\||\|$/g, '')
        .split('|').map(c => c.trim());
      const aligns = cells(lines[i + 1]).map(c =>
        c.startsWith(':') && c.endsWith(':') ? 'center' :
        c.endsWith(':') ? 'right' : 'left');
      const al = ci => aligns[ci] ? ` style="text-align:${aligns[ci]}"` : '';
      let t = '<table><thead><tr>';
      cells(line).forEach((c, ci) => t += `<th${al(ci)}>${inline(c)}</th>`);
      t += '</tr></thead><tbody>';
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i]) && lines[i].trim()) {
        t += '<tr>';
        cells(lines[i]).forEach((c, ci) => t += `<td${al(ci)}>${inline(c)}</td>`);
        i++;
      }
      html += t + '</tbody></table>';
      continue;
    }
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)(?:([-*+])|(\d+\.))\s+(.*)$/);
        if (!m) break;
        const t = m[4].match(/^\[([ xX])\]\s+(.*)$/);
        items.push({
          indent: m[1].replace(/\t/g, '  ').length,
          type: m[3] ? 'ol' : 'ul',
          num: m[3] ? parseInt(m[3]) : 0,
          task: !!t, checked: t ? t[1] !== ' ' : false,
          text: t ? t[2] : m[4],
          tIdx: t ? taskNo++ : -1
        });
        i++;
      }
      html += renderListBlock(items);
      continue;
    }
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isSpecial(lines[i]))
      buf.push(lines[i++]);
    html += `<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`;
  }
  return html;
}
