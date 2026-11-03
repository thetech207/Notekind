/* Injected into pages by sw.js via chrome.scripting.executeScript —
   must be self-contained (no imports). Grabs the selection if present,
   else article/main/body, strips junk, converts DOM → Markdown. The
   final expression's value is returned to the service worker. */
(() => {
  const sel = window.getSelection();
  let root, isSel = false;
  if (sel && !sel.isCollapsed && sel.toString().trim()) {
    const frag = document.createElement('div');
    for (let i = 0; i < sel.rangeCount; i++)
      frag.appendChild(sel.getRangeAt(i).cloneContents());
    root = frag; isSel = true;
  } else {
    root = document.querySelector('article') ||
           document.querySelector('main') || document.body;
  }
  const clone = root.cloneNode(true);
  clone.querySelectorAll(
    'script,style,noscript,iframe,svg,form,button,input,select,' +
    'nav,[role=navigation],[role=banner],[role=contentinfo],' +
    'header,footer,aside,.ad,.ads,.advert,[class*=cookie],[id*=cookie]'
  ).forEach(n => n.remove());

  const abs = u => { try { return new URL(u, location.href).href; } catch { return u; } };

  function md(node) {
    let out = '';
    for (const el of node.childNodes) {
      if (el.nodeType === 3) { out += el.textContent; continue; }
      if (el.nodeType !== 1) continue;
      const tag = el.tagName.toLowerCase(), inner = md(el);
      switch (tag) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          out += '\n\n' + '#'.repeat(+tag[1]) + ' ' + inner.trim() + '\n\n'; break;
        case 'p': out += '\n\n' + inner.trim() + '\n\n'; break;
        case 'br': out += '  \n'; break;
        case 'strong': case 'b': out += '**' + inner.trim() + '**'; break;
        case 'em': case 'i': out += '*' + inner.trim() + '*'; break;
        case 'code': out += '`' + inner + '`'; break;
        case 'pre': out += '\n\n```\n' + el.textContent.replace(/\n+$/, '') + '\n```\n\n'; break;
        case 'blockquote':
          out += '\n\n> ' + inner.trim().split('\n').join('\n> ') + '\n\n'; break;
        case 'a': {
          const href = el.getAttribute('href'), t = inner.trim() || href;
          out += href ? `[${t}](${abs(href)})` : t; break;
        }
        case 'img': {
          const src = el.src || el.getAttribute('src');
          if (src) out += `![${el.alt || ''}](${abs(src)})`; break;
        }
        case 'ul': case 'ol': {
          let i = 1;
          for (const li of el.children) {
            if (li.tagName.toLowerCase() !== 'li') continue;
            const mark = tag === 'ul' ? '-' : (i++) + '.';
            out += '\n' + mark + ' ' + md(li).trim().split('\n').join('\n  ');
          }
          out += '\n'; break;
        }
        case 'li': out += inner; break;
        case 'hr': out += '\n\n---\n\n'; break;
        case 'td': case 'th': out += inner + ' | '; break;
        case 'tr': out += '\n' + inner; break;
        case 'table': out += '\n' + inner + '\n'; break;
        default: out += inner;
      }
    }
    return out;
  }

  const body = md(clone)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title: document.title, url: location.href, sel: isSel, md: body };
})()
