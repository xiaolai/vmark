# Media Viewer — images / audio / video preview

Status: Phase 1 complete — shipped. All gates green; live E2E verified
(image/video/audio render natively; undecodable files show the fallback).

Key integration finding (ADR-6): the Tauri asset-protocol scope is
cwd-relative and does not cover arbitrary absolute paths, and nothing
extended it on open — so `convertFileSrc`/asset:// returned 403 for user
files (a latent bug that also affected inline images from outside the cwd).
Fix: `allow_fs_read` now also extends `asset_protocol_scope()`, and the media
open flow calls the `grant_asset_access` command per file before mounting the
viewer. This is deterministic across dev and production (unlike the static
scope) and tightens security — the asset protocol only serves explicitly
opened files.

Goal: preview media files (image / audio / video) inside VMark, like macOS
Finder — as a **viewer tab** (open a media file) and as a **Quick Look
overlay** (Space on a selected file in the explorer). Binary files are
**never read as UTF-8 text**; broad format coverage with graceful fallback.

## ADRs

### ADR-1 — New `FormatKind: "media"` (not `"viewer"`)

`"viewer"` and `"split-pane"` both fall through to `SplitPaneEditor`, which
always mounts a CodeMirror `SourcePane` on the tab's text content. Binary
media has no text content. A dedicated `"media"` kind gets its own branch in
`Editor.tsx` and renders a full-width `MediaView` with no source pane.

### ADR-2 — Data path: Tauri asset protocol, not base64

`convertFileSrc(normalizePathForAsset(path))` → `asset://` URL loaded natively
by the webview. Native streaming: video/audio seekable, bytes never enter the
JS heap. `assetProtocol.scope` is already `["**/*"]` in `tauri.conf.json`.
base64/data-URL rejected: +33% size, whole file in the JS string heap (large
video → OOM), no seeking.

### ADR-3 — No UTF-8 read for binary

Branch in `openFileInNewTabCore` (`useFileOpen.ts`) after tab+format resolve,
before `readTextFile`: if `format.kind === "media"`, call
`initDocument(tabId, "", path)` and return. `content` stays empty — hot-exit
captures/restores from the empty snapshot content and never re-reads the file
(verified: `restoreHelpers.ts` restores from snapshot, not disk). Media tabs
are excluded from the external-file watcher's text re-read
(`useExternalFileChanges.ts`).

### ADR-4 — Broad list + graceful fallback ("as many as possible")

Register all common image/video/audio extensions (source of truth:
`src/utils/mediaExtensions.ts`, minus `svg` which owns its own format).
`MediaView` attempts native `<img>/<video>/<audio>`; on element `error`,
shows a fallback panel ("can't preview inline") with **Open with default
app** + **Reveal in Finder**. macOS WKWebView decodes HEIC / mov-h264 / FLAC
natively, so coverage is wide there; unsupported codecs degrade, never crash.

### ADR-5 — Shared render core for both surfaces

One `MediaView` component (path → resolved `asset://` → typed element +
fallback). The viewer tab wraps it; the Quick Look overlay wraps it. Pixel
parity, one place to fix.

## Work items

- **WI-1 (core)**: add `"media"` to `FormatKind`; `registerFormat` carve-out
  so `kind:"media"` may use `closeSavePolicy:"save-as-only"` with
  `readOnlyDefault:true`; media format adapter (`adapters/media.tsx`);
  extend/confirm `mediaExtensions.ts`; open-flow branch in `useFileOpen.ts`.
- **WI-2 (surface)**: `MediaView` render core + `MediaViewer` tab surface +
  `Editor.tsx` `kind:"media"` branch + i18n keys.
- **WI-3 (quick look)**: `quickLookStore` + `QuickLookOverlay` (reuses
  `MediaView`) + FileExplorer Space handler reading `treeRef.selectedNodes`.
- **WI-4 (safety + docs)**: exclude media tabs from `useExternalFileChanges`;
  confirm close/dirty path treats empty media tab as never-dirty (no save
  prompt); `website/guide/formats.md` + settings docs.

### ADR-7 — MediaView owns the per-file asset grant

Live testing showed Quick Look (and arrow-nav) reach `MediaView` without going
through the tab-open path, so they never granted asset access → 403 → fallback.
Fix: `MediaView` grants `grant_asset_access` for its own path in an effect and
gates the media element on it. This makes EVERY entry point (tab, Quick Look,
arrow-nav, future embeds) serve real media, and it is the single source of the
grant (the open flow no longer grants). State is tracked per-path (not booleans)
so a path change resets granted/errored without a synchronous effect setState.

### Quick Look arrow navigation (Finder parity)

`quickLookStore` holds an ordered sibling list + index; the Space hotkey passes
the explorer's visible files (`TreeApi.visibleNodes`, folders excluded, display
order); the overlay's Left/Up → prev, Right/Down → next (clamped, no wrap), with
a "n / total" position indicator. Live-verified: photo.png (1/3) → clip.mp4
(2/3, `<video>`) → tone.wav (3/3, `<audio>`), Escape closes.

## DoD — met

`pnpm check:all` green; opening a `.png/.mp4/.mp3` shows the media (no UTF-8
read — asserted); Space opens the overlay, arrows navigate siblings; an
undecodable file shows the fallback panel; hot-exit round-trips a media tab
without serializing binary. Live E2E confirmed image/video/audio render, the
fallback works, and Quick Look arrow-nav walks the sibling list.
