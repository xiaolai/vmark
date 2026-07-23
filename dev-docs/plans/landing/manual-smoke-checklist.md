# Landing — manual E2E smoke checklist (per release)

The one honest coverage gap from Phase 0 WI-0.3: interactive behavior is not unit-covered
(VMark E2E needs a running debug app). **Every landing release (`v0.9.8` onward) records a
completed run of this checklist before tagging.** Run against a debug build
(`pnpm tauri:dev`); non-AI UI/plumbing uses the Tauri MCP (`mcp__tauri__*`, port 9323) per
`dev-docs/e2e-testing.md`. Record: release, tester, date, pass/fail per row.

> **Run `pnpm tauri:dev` from the branch checkout/worktree being tested** — launching it
> from `main` (reset to `v0.9.7`) runs the *old* code, so the app under test is not the
> branch. Verify with `lsof -a -p $(pgrep -f "pnpm tauri dev") -d cwd` if a result looks
> impossibly wrong (e.g. D1-D4 "still broken"). Many rows below are covered automatically by
> `pnpm e2e:journeys` — run that first.

Scope is the subsystems the refactor actually touched (Phase 0 footprint), not the whole app.

| # | Area | Check | Touched by | Pass |
|---|------|-------|-----------|------|
| 1 | WYSIWYG editing | Type, bold/italic, headings, lists — marks/nodes render + persist | nucleus, format-body | ☐ |
| 2 | Undo/redo | Multi-step undo then redo across mode switch — history intact, no desync | service-tier (history rewire) | ☐ |
| 3 | Autosave / close-save | Edit, wait for autosave; close a dirty tab and a clean tab; multi-tab close-all persists every doc | `da53f8c6`, service-tier | ☐ |
| 4 | Mode switching | WYSIWYG ↔ Source round-trips content unchanged; forced-Source on a large file | resolver routing | ☐ |
| 5 | Split pane | Open split; edit in source pane; validation gutter behaves | `a870a535` | ☐ |
| 6 | Paste / drag-drop | Paste markdown + rich HTML; drag an image in — correct nodes | pipeline | ☐ |
| 7 | Popups | Link, image, math, footnote popups open inside the editor container, position correctly | pipeline | ☐ |
| 8 | Window / workspace | Startup file-open, Finder "Open with", new window, close/focus, recent workspaces | service-tier | ☐ |
| 9 | Filesystem / external change | External edit to an open file is detected; save writes correct bytes | service-tier | ☐ |
| 10 | Fence renderers | mermaid / svg / markmap fenced blocks render; toggle source↔preview | `870449b9`/`2a84e376`, `8edfe830` | ☐ |
| 11 | Format services | Linter, outline panel, word count reflect the active format | format-body | ☐ |
| 12 | Terminal | Open terminal, type, IME commit (CJK) — no duplication; `terminalGate` intact | service-tier | ☐ |
| 13 | MCP workspace | `open_workspace`-style flow works against the built sidecar | service-tier (MCP bridge) | ☐ |
| 14 | Non-markdown formats | Open a YAML/JSON/SVG/TOML/plain file — correct adapter, no crash | format dispatch | ☐ |
| 15 | Round-trip spot-check | **Automated** — `pnpm e2e:journeys` includes `d1-d4-roundtrip-preserved` (media alt / link title / nested highlight / escaped `^` set in WYSIWYG → Source serializer → all four preserved in the live app). Run the journey suite against a debug build; only spot-check manually if it can't run. | D1–D4 | ☐ |

**Release-specific:** a release only needs the rows its slice touches (the "Touched by"
column). The `v0.10.0` nucleus release runs the **full** list. Attach the completed table to
the release note.
