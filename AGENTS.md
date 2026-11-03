# Notekind — agent notes

MV3 browser extension (Chromium). Local-first Markdown knowledge
journal + web clipper. Sister project to Tektite
(github.com/thetech207/Tektite) — keep vault conventions identical:
`YYYY/MM - Month/YYYY-MM-DD.md` daily notes, `[[wikilinks]]`,
`attachments/` for binaries.

## Architecture

- **MV3, no build step.** Vanilla ES modules; `"type": "module"`
  service worker allows static imports in `src/sw.js`.
- **CSP**: extension pages forbid inline `<script>` and inline event
  handlers — all JS lives in `.js` files wired via `addEventListener`.
  Inline `<style>`/`style.css` is fine.
- **Vault access**: File System Access API (`showDirectoryPicker`,
  `getDirectoryHandle`, `createWritable`) — same mechanism Tektite uses.
  The handle is persisted in IndexedDB (`notekind` DB, `kv` store via
  `src/idb.js`) and shared between extension pages and the service
  worker (same `chrome-extension://` origin).
- **Key open question** (the spike): whether `readwrite` permission on a
  persisted handle survives browser restart such that the SW can write
  silently. `sw.js` tests via `onStartup` (no gesture) and
  `contextMenus.onClicked` (SW gesture); results land in
  `chrome.storage.local` keys `nkStartup` / `nkMenuTest` shown on the
  spike page. If silent writes fail, plan B is a small confirm page
  opened per clip.
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
