# Notekind

A local-first knowledge journal and web clipper — daily notes, wikilinks,
and Markdown files that stay on your disk. A Manifest V3 browser
extension for Chromium browsers (Chrome, Edge, Brave, Arc).

> **Status: spike build v0.1.0** — this is an architecture experiment,
> not the app yet. See "Spike test" below.

Sister project of [Tektite](https://github.com/thetech207/Tektite) —
same vault conventions (`YYYY/MM - Month/YYYY-MM-DD.md` daily notes,
`[[wikilinks]]`, `attachments/`), so existing Tektite/Obsidian vaults
carry over.

## Vision

- **New-tab journal** — your daily note is a keystroke away
- **Web clipper** — context-menu capture of pages/selections into
  Markdown, Evernote/OneNote-style, stored as plain files you own
- **Silent background writes** — clips land in the vault without opening
  a UI (the subject of the current spike)
- No accounts, no sync service, no database — just `.md` files

## Install (sideload)

1. Clone or download this repo
2. `chrome://extensions` → enable **Developer mode**
3. **Load unpacked** → select the `Notekind/` folder
4. Open a new tab — the Notekind page replaces it

## Spike test

The whole architecture hinges on one question: **can a service worker
write to a persisted File System Access handle without a user gesture?**

To answer it:

1. New tab → **Choose vault folder** → pick a directory, grant
   read/write
2. **Write file (this page)** and **Write file (service worker)** —
   confirm `notekind-spike.txt` appears in the folder
3. **Restart the browser completely**, open a new tab
4. Check **Startup write**: `ok:true` means silent background clipping
   is viable; `permission-prompt` means we need a confirm-page fallback
5. Right-click any page → **Notekind: test vault write** → check
   **Context-menu write** — tests the on-gesture SW path and whether
   `requestPermission` can prompt from a worker

## Layout

```
manifest.json        MV3: module service worker, newtab override,
                     contextMenus + storage permissions
src/
  sw.js              service worker — write tests, startup/menu hooks
  idb.js             IndexedDB KV store (shared: pages + SW)
  app/
    index.html       new-tab spike page
    app.js           vault picker, write tests, result display
    style.css
icons/
```

## Roadmap

1. ~~Spike: silent SW writes to persisted handle~~ ← you are here
2. Skeleton: real new-tab journal (daily note editor)
3. Port Tektite core: tree, preview, wikilinks, tasks, calendar
4. Clipper: context menu → Readability/Defuddle → Turndown →
   `attachments/` for images
5. Side panel, commands, options page

## License

MIT
