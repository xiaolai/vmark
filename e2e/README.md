# VMark E2E Harnesses

Two zero-dependency Node harnesses drive a **live VMark debug build** through
its Tauri MCP automation bridge (`ws://127.0.0.1:9323`):

| Harness | Command | Scope |
|---------|---------|-------|
| Smoke | `pnpm e2e:smoke` | Minimal happy path: connect → scratch tab → type → round-trip → screenshot → discard |
| Journeys | `pnpm e2e:journeys` | 35 user journeys covering jsdom-unreachable flows: tabs, mode switches, formatting, undo/redo, find bar, outline, open/save-to-disk, D1-D4 round-trip, non-markdown format dispatch, workflow split-pane, terminal workspace cwd/cd-sync, the Tier-0 data-integrity set (multi-doc save isolation, dirty-file close guard, autosave-to-disk, line-ending preservation, failed-save document preservation, external-change auto-reload), and the macOS-only embedded-browser set (open/read/act, approvals and their invalidation, SSRF policy per hop, no-bridge, occlusion, session round-trip, disabled gate, human takeover) |

Shared bridge client: `e2e/lib/bridge.mjs`. App-level driving/observation
helpers: `e2e/lib/vmark.mjs`. Disk fixtures: `e2e/lib/fixtures.mjs`.

---

# Journey suite (`pnpm e2e:journeys`)

Runner: `e2e/run-journeys.mjs`. Journeys live in `e2e/journeys/`, each
exporting `{ name, run(client, ctx) }`; they run sequentially over one bridge
connection, print `PASS`/`FAIL`/`SKIP` per journey with timing, and exit
non-zero if any fail. On failure a native screenshot lands in
`e2e/artifacts/<journey>-fail.png`.

```bash
pnpm e2e:journeys                        # all journeys
node e2e/run-journeys.mjs --only save    # name-substring filter
# flags: --port 9323  --host 127.0.0.1  --timeout 15000
```

## Journeys

| Journey | Verifies |
|---------|----------|
| `boot-editor-ready` | Window listed, editor surface mounted, Tauri event/invoke channels live, exactly one active tab (read-only) |
| `scratch-tab-roundtrip` | New untitled tab → typed marker round-trips → dirty dot on that tab only → dirty close is refused without `force` → forced discard restores state |
| `mode-switch-preserves-content` | `menu:source-mode` WYSIWYG → CodeMirror → WYSIWYG, content preserved both directions |
| `tab-lifecycle` | Two scratch tabs with distinct content; switching moves `aria-selected` and the editor shows each tab's own document (per-tab isolation) |
| `formatting-bold` | Select word → `menu:bold` → rendered `<strong>` → Source view shows `**word**` (serialization) |
| `undo-redo` | `menu:undo` removes the bold mark (text intact); `menu:redo` restores it — unified history via real menu path |
| `find-bar` | `menu:find-replace` opens `.find-bar` with full controls; Escape closes it |
| `outline-toggle` | Real `<h1>` via `menu:heading-1`; `menu:outline` shows the panel listing the heading; visibility restored to initial |
| `open-from-disk` | Fixture file → `app:open-file` (Finder-open pipeline) → new tab, correct content, loads clean |
| `save-to-disk` | Open fixture → edit in live editor → `menu:save` → dirty clears → **Node reads the file from disk** and asserts the edit landed |
| `d1-d4-roundtrip-preserved` | Media alt / link title / nested highlight / escaped `^` set in WYSIWYG → `menu:source-mode` serializes → all four D1-D4 fixes preserved in the live serializer (not just the jsdom unit/property tests) |
| `nonmd-format-dispatch` | A `.json` fixture opened via the Finder-open pipeline mounts the CodeMirror **source** surface (no `.ProseMirror`) with its bytes — the format registry (WI-4A) routes non-markdown to the source host, not the markdown WYSIWYG editor |
| `workflow-split-pane` | A workflow-shaped YAML fixture opens the split-pane surface; the source pane edits and the preview/validation behave |
| `multi-doc-save-integrity` **(Tier-0)** | Two file-backed docs edited with distinct markers and saved; Node reads BOTH from disk and asserts each holds ONLY its own marker — no cross-tab write bleed |
| `dirty-file-close-guard` **(Tier-0)** | A dirty file tab REFUSES a non-force close (`{closed:false, reason:"DIRTY"}`, no dialog); after `menu:save` the clean tab closes on a non-force close |
| `autosave-persists-to-disk` **(Tier-0)** | Edit a file-backed doc, then WITHOUT an explicit save, wait for the real autosave interval and read the bytes back from disk. Slowest journey; SKIPs if autosave is off or its interval is too large |
| `line-ending-preservation` **(Tier-0)** | A CRLF document edited and saved comes back off disk still CRLF. Reads the live `lineEndingsOnSave` preference and derives the expectation from it (`preserve`/`lf`/`crlf`), so it asserts the real contract under the user's actual configuration |
| `failed-save-preserves-document` **(Tier-0)** | A save that FAILS (parent directory made read-only) must leave the original bytes untouched AND the tab dirty — no false success. Then proves recovery: restoring writability makes the same save succeed with exact bytes |
| `external-change-reloads-clean-doc` **(Tier-0 · I11)** | A clean document rewritten on disk by another process auto-reloads: new content present, old content gone (replace, not merge), tab still clean. The dirty branch stays manual — it raises a native dialog |

The runner appends a suite-level `state-restoration` check: the tab bar must
be byte-identical to the pre-suite snapshot.

**Assertion strength.** The **explicit-save integrity** journeys
(`save-to-disk`, `multi-doc-save-integrity`, `line-ending-preservation`,
`failed-save-preserves-document`) compare the **whole expected buffer**, not
`includes(marker)`. A substring oracle passes on a file that was truncated,
half-overwritten, BOM-prefixed, line-ending-converted, or contaminated with
another document's text — i.e. on most of the corruption modes they exist to
catch. `autosave-persists-to-disk` still uses a substring probe (upgrading it
needs the settings-profile work below), and the open/format-dispatch journeys
assert surface routing rather than saved bytes.

Expected buffers derive their EOL from the live `lineEndingsOnSave` preference
via `expectedEol()` — hardcoding `\n` would fail on **correct** output whenever
a user has chosen `crlf`.

**`coverageRequired`.** A journey declares it only when *every* skip it can take
is genuinely lost coverage — then a skip turns the run RED instead of printing
`JOURNEYS PASSED` with the invariant unasserted. The disk journeys skip when a
workspace is open, so **running the suite with a workspace open now fails the
run by design**: close the workspace (or use a disposable profile) before a
coverage-bearing run. Skips encoding valid *user state* are excluded —
`autosave-persists-to-disk` (autosave may be off) and `terminal-workspace-cd-sync`
(pre-existing workspace / session cap) are deliberately NOT required; see the
matrix note.

**Fixed sleeps.** Waits should be `poll()` against an observable signal. Beyond
the 400 ms teardown settle, the suite has no fixed sleeps: `failed-save-…` polls
for the error toast that marks an observed failure (a bare sleep could not tell
"failed" from "not started yet"), and `external-change-…` re-writes with a fresh
sequence marker until a reload is observed rather than guessing a
watcher-registration delay.

**Tier-0 (data integrity)** journeys guard the unrecoverable failure class —
silently losing or corrupting a user's document. They are the ones where unit
coverage is structurally a lie (they need real tabs, real files, the real
save/autosave pipeline). See `dev-docs/e2e-tier0-matrix.md` for the full
invariant × journey matrix, including the data-integrity invariants that stay
manual-only and why.

## Driving mechanisms (discovered + verified live)

- **Menu commands**: `window.__TAURI__.event.emit("menu:<id>", "<windowLabel>")`
  — broadcast emit reaches the window-scoped listeners
  (`useUnifiedMenuCommands`, `services/commands/menuListener`), which filter on
  payload === window label.
- **App automation surface**: `emit("mcp-bridge:request", {id, type, args_json})`
  drives the app's own v2 MCP handlers (`src/hooks/mcpBridge/v2/`):
  `vmark.workspace.new` / `close {tabId, force}` / `switch_tab`. Responses go
  to Rust (`__TAURI_INTERNALS__.invoke` is non-writable, so they can't be
  intercepted from injected JS); every effect is asserted via the DOM instead.
- **Content**: `setEditorContent` fires the app's own `vmark.document.write`
  handler via `mcp-bridge:request` (the synchronous-flush path the shipping MCP
  surface uses). DOM `execCommand` typing was abandoned here: the small-doc
  editor→store flush uses `requestAnimationFrame` (`useTiptapFlush.ts`), which
  the OS throttles when the automated window is backgrounded, so typed content
  lands in the editor DOM but never syncs to the store (the tab never dirties).
  `document.write` flushes synchronously and is focus-independent.
- **Observation**: tab bar `[role="tab"][data-tab-id]` (title / `aria-selected`
  / `.tab-dirty-dot`), `.ProseMirror` / `.cm-editor` surfaces, `.find-bar`,
  `.outline-view`.
- **Waits**: every wait is a poll-with-timeout (`poll()` in `lib/vmark.mjs`);
  the only fixed sleep is a 400 ms pre-close settle for the editor's debounced
  content sync (see safety model).

## Safety model

The suite assumes the live app may hold **real user documents** and enforces:

1. **Never touch pre-existing tabs.** All edits happen in tabs the journey
   created itself; `typeInActiveEditor` refuses to type into a non-empty or
   stale (pre-switch) editor instance.
2. **Close by explicit tab id only.** Teardown force-discards only
   journey-created tab ids; `vmark.workspace.close` cannot hit the wrong tab.
   Dirty pre-existing tabs are never closed, saved, or modified.
3. **No native dialogs.** Paths that would open one (Save dialog on untitled,
   dirty-close prompt) are avoided by construction; the bridge close handler
   refuses dirty closes instead of prompting.
4. **Restore what you toggle.** Mode switches, outline visibility, and the
   active tab are restored in `finally` blocks; each mutating journey verifies
   its own before/after tab-bar snapshot, and the runner verifies the suite's.
5. **Disk writes only in throwaway dirs.** Fixtures live in a uniquely
   suffixed `~/.vmark-e2e-<stamp>/` dir, removed in teardown. (`$HOME` rather
   than `os.tmpdir()` because the Tauri fs capability scope is `$HOME/**` —
   macOS's `/var/folders` tmpdir is unreachable for the app.)
6. **Editor rebind + sync guards.** The tab bar updates before the editor
   remounts, and the WYSIWYG surface syncs editor → document store on a
   debounce that targets the tab active *at flush time*. Helpers tag the old
   editor DOM node and wait for a fresh instance, wait for the dirty dot after
   typing, and settle 400 ms before closing an edited tab — otherwise typed
   content can land in the WRONG tab (a real app bug found while building this
   suite; see "Known app issues").
7. **Skip over spawn.** `open-from-disk` / `save-to-disk` SKIP when a
   workspace is open — the Finder-open branch for an outside-workspace file
   would spawn a new window, which the suite must never do. A guard scratch
   tab also prevents the "replaceable tab" branch from consuming a
   pre-existing clean untitled tab.

**Known residue (documented, unavoidable from outside the app):** the disk
journeys add one recent-files entry for the fixture. The persisted copy
(`localStorage["vmark-recent-files"]`) is snapshotted and restored, so nothing
survives an app restart, but the in-memory recents menu of the current session
still lists the (deleted) fixture path until reload.

## Known app issues found by this suite

- **Cross-tab content bleed (data-loss risk):** type into a tab, then create or
  switch tabs before the (>=100 ms adaptive) debounce flushes — the pending
  content is written into the NEWLY ACTIVE tab's document, and the original
  tab stays empty. Reproduced deterministically via
  `execCommand("insertText")` immediately followed by `vmark.workspace.new`.
- **HMR crash (dev-only):** a Vite hot reload can re-run
  `useCommandBootstrap` registrations and crash the window with
  `Command already registered: view.toggleSourceMode` (error boundary).
  Recover with a webview reload.

## Prerequisites

Identical to the smoke harness (see below): a live debug build
(`pnpm tauri:dev`) with the document window open, on a headed display. Same
CI caveats apply — this suite is for local / manually triggered headed runs,
not the blocking `pnpm check:all` gate. Journeys tolerate the dev app's
Vite-reload churn only between journeys; a reload mid-journey fails that
journey (rerun once the app is stable).

---

# VMark E2E Smoke Harness

> **RW-13 (L12) · hardening v2-005** — closes the audit gap "No executable E2E
> smoke harness." See `dev-docs/audit/20260607-wi-audit-report.md` (L12 / v2-005).

A minimal, runnable happy-path smoke test that drives a **live VMark debug
build** through its Tauri MCP automation bridge.

> The smoke test follows the same safety model as the journey suite: all
> typing happens inside a scratch tab it creates itself (verifiably empty
> before insertion), which is force-discarded in teardown. Pre-existing tabs
> are never typed into, cleared, or left dirty.

## What it exercises

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | Connect to the automation bridge WebSocket | Connection opens on `127.0.0.1:9323` |
| 2 | `list_windows` | At least one window/webview is reported |
| 3 | `execute_js` — probe the webview | `.ProseMirror` editor is present and the IPC result channel is live |
| 4 | Create a scratch tab (`vmark.workspace.new`) | New empty untitled tab appears, becomes active, editor rebinds |
| 5 | `execute_js` — focus editor, `execCommand("insertText", …)` | A unique marker string is typed into the (empty) scratch document; dirty dot confirms the editor→store sync |
| 6 | `execute_js` — read `.ProseMirror` textContent back | Content contains the typed marker (round-trip verified) |
| 7 | `capture_native_screenshot` | A base64 PNG is returned and written to `e2e/artifacts/smoke.png` |
| 8 | Teardown (`withTabRestore`) | Scratch tab force-discarded; tab bar identical to the pre-test snapshot |

Exit code is `0` only if every step passes; any failure (connection,
assertion, or timeout) exits non-zero and prints a `FAIL` line.

## Why the Tauri MCP bridge, not Chrome DevTools

VMark is a **Tauri desktop app**, not a browser page. Per `AGENTS.md`:

- The automation bridge (`tauri-plugin-mcp-bridge`, **debug-only**) is pinned to
  `127.0.0.1:9323` in `src-tauri/src/lib.rs`.
- Port **9223** is VMark's *own*, auth-protected MCP server (sidecar ↔ webview).
  Sending commands there drops with `"Connection closed"`. **This harness uses
  9323 only.**
- **Never use Chrome DevTools MCP** for VMark.

## Wire protocol

The bridge is a plain WebSocket server. The harness speaks its JSON
request/response protocol directly (verified against
`tauri-plugin-mcp-bridge 0.8` `src/websocket.rs`):

```jsonc
// request
{ "id": "smoke-1", "command": "execute_js", "args": { "script": "…" } }
// response
{ "id": "smoke-1", "success": true, "data": <json> }
// or
{ "id": "smoke-1", "success": false, "error": "…" }
```

Commands used: `list_windows`, `execute_js`, `capture_native_screenshot`.

## Dependencies

**None.** The harness uses Node's built-in global `WebSocket` (stable in
Node ≥ 22; this repo runs Node 22). No `ws` package, no MCP client library is
required or added.

## Prerequisites

1. **A live VMark debug build** so the 9323 bridge is active (it is compiled in
   only under `#[cfg(debug_assertions)]`):

   ```bash
   pnpm tauri:dev
   ```

   Wait until the document window is open and the editor is visible.

2. **A headed environment (a real display).** Step 6 captures a *native*
   screenshot of the OS window, which cannot succeed on a headless runner
   without a virtual display (e.g. an Xvfb/`runner` with a display, or a macOS
   self-hosted runner with a logged-in GUI session). Steps 1–5 are
   display-independent, but the harness asserts the screenshot too, so treat the
   whole smoke as **headed-only**.

## Running

With the debug app already running:

```bash
pnpm e2e:smoke
# equivalently:
node e2e/smoke.mjs
```

Options:

| Flag | Default | Purpose |
|------|---------|---------|
| `--port <n>` | `9323` | Bridge port |
| `--host <addr>` | `127.0.0.1` | Bridge host |
| `--timeout <ms>` | `15000` | Per-step timeout (also the connect timeout) |

The screenshot is written to `e2e/artifacts/smoke.png` (gitignored).

### Running via a Tauri MCP session (agent-driven)

An AI agent can perform the same flow interactively with the `tauri_*` MCP
tools (see `.claude/skills/tauri-mcp-testing`): `tauri_driver_session`
(`action: start`, `port: 9323`) → `tauri_manage_window` (`list`) →
`tauri_webview_execute_js` to type/verify → `tauri_webview_screenshot`. This
script is the **non-interactive, CI-shaped** equivalent of that flow.

## CI

This smoke is **not** wired into the per-PR CI gate. Doing so honestly requires
a headed runner (display + a running debug build), which the current CI
infrastructure does not provide. Running it under a headless GitHub-hosted
runner would fail at the native-screenshot step and produce false negatives.

Run it **locally / manually** before releases, or on a self-hosted headed
runner via a dedicated `workflow_dispatch` job if/when one exists. Keep it out
of the blocking `pnpm check:all` gate until that infrastructure is in place.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `Timed out connecting … on port 9323` | Debug app not running, or built in release mode (bridge is debug-only). Start `pnpm tauri:dev`. |
| `Connection closed` immediately | You hit port **9223** (the auth-protected app bridge). Use 9323. |
| `No .ProseMirror editor surface found` | App still booting, or a non-document window is focused. Wait for the editor, retry. |
| `window.__TAURI__.event.emit is unavailable` | Not the document webview, or not a Tauri build. |
| `Screenshot did not return a base64 data URL` | Headless environment with no display. Run headed. |
