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

## How it stores notes

**IndexedDB is the source of truth** — notes are stored internally,
keyed by their vault-relative path, so silent writes work everywhere
(service worker included) with zero permission prompts.

- **Export** — one click produces a `.zip` of plain `.md` files in
  Tektite's vault layout
- **Vault sync** (optional) — pick a folder once; when permission is
  granted (one click per session), every write also lands as a real
  `.md` file readable by Tektite and Obsidian
- **Import** — point it at an existing Tektite/Obsidian vault to bring
  your notes in

> ⚠️ Uninstalling the extension wipes IndexedDB. Export regularly or
> keep vault sync on.

Spike result: handle permission resets to `prompt` each session —
silent vault writes at startup are not possible; hence IDB-first.

## Layout

```
manifest.json        MV3: module service worker, newtab override,
                     storage + contextMenus + downloads permissions
src/
  sw.js              service worker — writes via store (IDB + mirror)
  idb.js             IndexedDB layer (kv, notes, blobs stores)
  store.js           storage model: notes CRUD, vault mirror,
                     import/export
  vendor/fflate.js   zip for export (vendored, MIT)
  app/
    index.html       new-tab page
    app.js           vault picker, sync/import/export, tests
    style.css
icons/
```

## Roadmap

1. ~~Spike: silent SW writes to persisted handle~~ — result:
   `permission-prompt` per session, so IDB-first architecture
2. ~~Storage layer: IDB source of truth + vault mirror + zip export~~
   ← you are here
2. Skeleton: real new-tab journal (daily note editor)
3. Port Tektite core: tree, preview, wikilinks, tasks, calendar
4. Clipper: context menu → Readability/Defuddle → Turndown →
   `attachments/` for images
5. Side panel, commands, options page

## License

MIT
