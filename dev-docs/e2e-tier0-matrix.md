# E2E Tier-0 — Data-Integrity Invariant × Journey Matrix

**Tier-0 = the unrecoverable failure class:** silently losing or corrupting a
user's document. These are the invariants where lower-layer coverage is
structurally a lie — proving them needs *real* tabs, *real* files, and the
*real* editor → store → disk pipeline, which jsdom/Vitest cannot assemble.
Everything else (formatting rules, parsing, CJK, tokens, availability policy) is
already better covered below the E2E line and does **not** belong here.

All rows drive the app through the **Tauri MCP** automation bridge
(`ws://127.0.0.1:9323`, debug-only) via the journey harness (`pnpm e2e:journeys`,
`e2e/journeys/`). None of these are AI-surface features, so none use the VMark
MCP bridge — see "AI-surface data integrity" below for that separate lane.

> Run against a live debug build: `pnpm tauri:dev` (headed), then
> `pnpm e2e:journeys`. This suite is **not** in `pnpm check:all` — it needs a
> running app and a display. See `dev-docs/e2e-testing.md` for the bridge model
> and `e2e/README.md` for the harness safety model.

## The matrix

| # | Data-integrity invariant | Failure mode if it breaks | Journey | Status |
|---|--------------------------|---------------------------|---------|--------|
| I1 | Edited content round-trips through the live editor | Typed text never reaches the document model → lost on save | `scratch-tab-roundtrip`, `formatting-bold` | ✅ automated |
| I2 | WYSIWYG ↔ Source preserves content (both directions) | Mode switch silently drops/mangles content | `mode-switch-preserves-content`, `d1-d4-roundtrip-preserved` | ✅ automated |
| I3 | Explicit save writes the correct bytes to the file | Save writes wrong/partial bytes → on-disk corruption | `save-to-disk` (Node reads bytes back) | ✅ automated |
| I4 | Multi-document save isolation (no cross-tab write bleed) | One doc's edit written into another's file | **`multi-doc-save-integrity`** (new) | ✅ automated |
| I5 | Dirty document refuses a silent close; clean closes | Unsaved edits discarded without a prompt | **`dirty-file-close-guard`** (new) + `scratch-tab-roundtrip` (untitled half) | ✅ automated |
| I6 | Autosave reaches disk without an explicit save | The silent-protection guarantee fails → edits lost on crash | **`autosave-persists-to-disk`** (new) | ✅ automated (slow) |
| I7 | Undo/redo preserves content across history ops | History desync corrupts the document | `undo-redo` | 🟡 partial — cross-**mode** undo (source↔WYSIWYG) not yet a journey |
| I8 | Non-markdown routes to the source editor (right surface) | A non-md file edited through the md WYSIWYG editor → corruption on save | `nonmd-format-dispatch` | ✅ automated |
| I9 | Multi-tab **close-all** persists every open document | Bulk close loses docs whose flush didn't land | — | 🟡 partial — I4 proves per-file save isolation; full close-all persistence needs hot-exit (I10) |
| I10 | Hot-exit: unsaved edits restored after app **restart** | Crash/quit loses in-flight work | — | 🔴 manual — the single-connection harness cannot restart the app |
| I11 | External file change detected; no silent overwrite | App overwrites an edit made outside VMark | — | 🔴 manual — file-watch scope + reload policy (may surface an in-app dialog) need live discovery |
| I12 | Cross-tab **debounce** bleed does NOT occur | Type in A, switch to B before flush → A's content lands in B | — | 🔴 manual/irreducible — reproducing the race needs `execCommand` timing, which RAF-throttles when the window is backgrounded (documented in `e2e/README.md`) |
| I13 | Terminal **spawns in the workspace root** | The shell silently lands in `$HOME`; every relative path — including destructive ones (`rm -rf *`) — resolves against the wrong tree | **`terminal-workspace-cwd`** (new) | ✅ automated · `coverageRequired` |
| I14 | Terminal `VMARK_WORKSPACE` env matches the workspace | Shell scripts keyed to the env var operate on the wrong tree | — | 🔴 manual — macOS SIP blocks reading another process's environment (`ps eww` returns nothing), so this half of the spawn contract is unobservable from the harness |
| I15 | A **running** shell follows a workspace **switch** | Shell keeps operating in the previous project's tree while the UI shows the new one — commands land where the user is not looking | **`terminal-workspace-cd-sync`** (new) | ✅ automated (skips only if a workspace is already open) |

Legend: ✅ automated in the journey suite · 🟡 partially covered · 🔴 manual-only
(with the reason it cannot be automated in this harness).

## I13/I15 — what makes a terminal journey lie, and how these avoid it

Everything below was hit while building these journeys. Read before touching
terminal E2E; each item produced, at some point, a **passing test that proved
nothing**.

1. **The terminal cannot open without a workspace.**
   `terminalGate.canOpenTerminal()` requires workspace mode *or* an active tab
   with a saved file, and otherwise refuses the toggle with a toast. This is a
   product gate, not a harness quirk: any terminal journey must establish a
   workspace *first*, and a journey that toggles the terminal beforehand fails
   with a bare "panel never mounted" that looks like a bug in the harness.

2. **Two independent code paths produce the same observable.** VMark reaches
   "shell cwd == workspace root" both by `spawnPty.ts` (create-time CWD) and by
   `terminalSessionStoreSync.ts`, which writes a `cd` into *already-running*
   sessions when the root changes. A surviving shell satisfies a naive cwd check
   even if the other path is completely broken — I13 was observed passing that
   way. The rule this yields: **assert an identity only the intended path can
   produce.** I13 demands a shell PID that did not exist before (a `cd` cannot
   forge one); I15 demands the *same* PID moved (a respawn cannot forge that).
   The two are complements and neither can pass through the other's mechanism.

3. **"Panel closed" does not mean "no session."** `TerminalPanel` latches xterm
   on first show and thereafter hides with `display: none` rather than
   unmounting, so `.terminal-container` is permanently present once the terminal
   has ever been opened — presence is not a visibility signal (use the panel's
   computed `display`). A session also survives every toggle, and one whose shell
   has *exited* still suppresses auto-create while only respawning on the next
   keypress (`terminalSessionInputWiring.ts`). So killing a shell to "get a clean
   slate" yields a state where opening the terminal spawns nothing at all.

   The resolution is to stop depending on ambient state: both journeys **create
   their own session** through the tab bar's `data-terminal-action="new"` hook
   and dispose it with `close`. That makes them repeatable on every run and
   leaves any session the user already had untouched. Counting sessions is
   alive-aware (`terminal-tab-dead`), because "no sessions" and "one dead
   session" imply opposite spawn behaviour.

4. **A skip looks exactly like coverage.** The suite prints `JOURNEYS PASSED`
   with skips in the count, so an invariant marked ✅ here can silently stop
   being asserted. A journey may now declare `coverageRequired: true`; the runner
   fails the run if such a journey skips. I13 carries it (it has no
   environmental reason to skip); I15 does not, because it legitimately skips
   when a workspace is already open.

Terminal output itself is **not readable from the harness**: the WebGL renderer
paints to a canvas (no `.xterm-rows`), the helper textarea ignores
`execCommand("insertText")`, and the PTY handle lives in a React ref. That is why
both journeys assert against the OS process table instead of terminal output.

## Why I10–I12 stay manual (and where they live)

These are not gaps to "fix later by trying harder" — they are structurally
outside the single-WebSocket, single-session journey harness:

- **I10 hot-exit restore** requires quitting and relaunching the app; the harness
  holds one connection to one running process. → Covered by the per-release
  **`dev-docs/plans/landing/manual-smoke-checklist.md`** (row 3) and any
  crash-recovery manual pass.
- **I11 external change** depends on the OS file watcher and the reload-policy
  (`useExternalFileChanges` → `resolveExternalChangeAction` → `reloadFromDisk`),
  whose clean-tab auto-reload vs dirty-tab prompt branch may show an in-app
  dialog. Automating it safely needs a live discovery pass first (does the
  watcher cover files opened outside a workspace? is the clean-tab reload
  dialog-free?). Until then: manual.
- **I12 cross-tab debounce bleed** can only be *provoked* with `execCommand`
  typing immediately followed by a tab switch — the exact path the harness
  abandoned because the RAF editor→store flush is throttled when the automated
  window is backgrounded. A headed manual repro is the honest tool. The
  `multi-doc-save-integrity` journey (I4) guards the *save-path* bleed
  deterministically; the *debounce-path* bleed is manual.

## AI-surface data integrity (separate lane, not in this matrix)

The AI tools that write documents — `document`/`workspace` via the **VMark MCP**
bridge (the shipping AI surface) — have their own data-integrity invariants
(e.g. `document.write` replaces vs appends correctly; a write targets the tab the
agent named). Those must be tested through **VMark MCP exclusively**, never the
Tauri harness (which would test a path users never take). That lane is scoped
separately; this matrix is the non-AI editor/persistence core only.

## Growing this matrix

1. Close I7 with a cross-mode undo/redo journey (edit in WYSIWYG, switch to
   Source, undo, assert the byte-level content is intact).
2. Do the I11 live-discovery pass; if the clean-tab reload is dialog-free,
   promote it to an automated journey (open clean fixture → external write →
   assert editor content updates to the new bytes).
3. Leave I10/I12 in the manual checklist — automating them would require app
   restart / backgrounded-RAF control this harness deliberately does not have.

A blank cell in this table is the unit of "what's untested" — grow coverage by
filling cells, not by adding journeys for details already covered below the E2E
line.
