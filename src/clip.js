/* Injected into pages by sw.js via chrome.scripting.executeScript —
   must be self-contained (no imports). Vendor scripts (Readability,
   Turndown, turndown-plugin-gfm) are injected first so their globals
   exist here. Selection clips bypass Readability and go straight to
   Turndown; the hand-rolled converter stays as a no-deps fallback.
   The final expression's value is returned to the service worker. */
(() => {
  const sel = window.getSelection();
  let html, title = document.title, isSel = false;
  const meta = {};

  if (sel && !sel.isCollapsed && sel.toString().trim()) {
    const d = document.createElement('div');
    for (let i = 0; i < sel.rangeCount; i++)
      d.appendChild(sel.getRangeAt(i).cloneContents());
    html = d.innerHTML;
    isSel = true;
  } else {
    /* crude main-content grab first — our baseline */
    const root = document.querySelector('article') ||
                 document.querySelector('main') || document.body;
    const clone = root.cloneNode(true);
    clone.querySelectorAll(
      'script,style,noscript,iframe,svg,form,button,input,select,' +
      'nav,[role=navigation],[role=banner],[role=contentinfo],' +
      'header,footer,aside,.ad,.ads,.advert,[class*=cookie],[id*=cookie]'
    ).forEach(n => n.remove());
    const grabLen = clone.textContent.trim().length;

    /* Readability is article-tuned — it only wins when it clearly
       captured the page: keep ≥60% of the crude grab's text or it
       extracted a fragment and the crude grab wins instead */
    let art = null;
    if (typeof Readability === 'function') {
      try {
        if (!Readability.isProbablyReaderable ||
            Readability.isProbablyReaderable(document.cloneNode(true)))
          art = new Readability(document.cloneNode(true)).parse();
      } catch {}
    }
    const artLen = (art?.textContent || '').trim().length;
    if (art && art.content && artLen >= Math.max(400, grabLen * 0.6)) {
      html = art.content;
      title = art.title || title;
      meta.byline = art.byline;
      meta.excerpt = art.excerpt;
    } else {
      html = clone.innerHTML;
    }
  }

  let body = null;
  if (typeof TurndownService === 'function') {
    const td = new TurndownService({
      headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-'
    });
    if (typeof turndownPluginGfm === 'object' && turndownPluginGfm.gfm)
      td.use(turndownPluginGfm.gfm);
    body = td.turndown(html);
  }

  if (!body) {
    /* no-deps fallback: minimal DOM → Markdown walker */
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const abs = u => { try { return new URL(u, location.href).href; } catch { return u; } };
    const walk = node => {
      let out = '';
      for (const el of node.childNodes) {
        if (el.nodeType === 3) { out += el.textContent; continue; }
        if (el.nodeType !== 1) continue;
        const tag = el.tagName.toLowerCase(), inner = walk(el);
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
              out += '\n' + mark + ' ' + walk(li).trim().split('\n').join('\n  ');
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
    };
    body = walk(holder)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return { title, url: location.href, sel: isSel,
           md: (body || '').trim(), byline: meta.byline, excerpt: meta.excerpt };
})()
