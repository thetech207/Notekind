# Notekind — agent notes

MV3 browser extension (Chromium). Local-first Markdown knowledge
journal + web clipper. Sister project to Tektite
(github.com/thetech207/Tektite) — keep vault conventions identical:
`YYYY/MM - Month/YYYY-MM-DD.md` daily notes, `[[wikilinks]]`,
`attachments/` for binaries.

## Architecture

- **MV3, no build step.** Vanilla ES modules; `"type": "module"`
  service worker allows static imports in `src/sw.js`.
- **Storage model** (decided 2026-11-03, spike result): IndexedDB is the
  source of truth — no permission model, silent writes everywhere
  including the service worker. `src/store.js` is the single entry
  point: notes keyed by vault-relative path (`YYYY/MM - Month/
  YYYY-MM-DD.md`), attachments in the `blobs` store.
- **Vault mirror** (opt-in): a FileSystemDirectoryHandle persisted in
  IDB `kv`/`vault`. Handle survives restarts but `readwrite` permission
  returns to `prompt` each session (verified in Vivaldi via the
  onStartup spike → `permission-prompt`). When `queryPermission` says
  `granted`, every write mirrors to real `.md` files via `mirrorWrite`;
  `mirrorAll` reconciles bulk. One gesture per session enables it.
- **Export**: `exportZip()` → all notes+blobs as a `.zip` of plain
  `.md`/files via vendored `fflate` (`src/vendor/fflate.js`, 0.8.2).
  Page-side `<a download>`; `downloads` permission is reserved for a
  future scheduled SW backup.
- **Import**: `importVault(dir)` walks a Tektite/Obsidian folder into
  IDB (`.md` → notes, rest → blobs) — the migration/onboarding path.
- **Data-loss caveat**: uninstalling the extension wipes IndexedDB —
  users on internal-only storage must export or enable sync. Call this
  out in UX; don't bury it.
- **CSP**: extension pages forbid inline `<script>` and inline event
  handlers — all JS lives in `.js` files wired via `addEventListener`.
- **Popup gotcha**: never put the picker in a toolbar `action` popup —
  popups close when a file picker opens. Use the new-tab page, side
  panel, or options page for vault selection.
- **Vivaldi**: ignores `chrome_url_overrides.newtab` (shows its Start
  Page). Document the "Settings → Tabs → New Tab Page → Specific Page →
  chrome-extension://<id>/src/app/index.html" workaround; side panel /
  action button matter more for Vivaldi coverage.
- **Popup gotcha**: never put the picker in a toolbar `action` popup —
  popups close when a file picker opens. Use the new-tab page, side
  panel, or options page for vault selection.

## Conventions

- Keep it dependency-free. If a dep is needed (Readability/Defuddle,
  Turndown for clipping), vendor the file into `src/vendor/` with a
  comment noting source + version.
- ES modules everywhere; no bundler, no transpile.
- Vault file format is the contract — notes must remain plain `.md`
  readable by Tektite and Obsidian.

## Verify

- No build/test suite yet. `chrome://extensions` → Load unpacked →
  select repo dir → open a new tab and exercise the spike page.
- Firefox can parse-check `src/app/app.js`/`idb.js` but cannot run the
  extension (needs `chrome.*` + File System Access API).
- Repo: github.com/thetech207/Notekind (when published).
