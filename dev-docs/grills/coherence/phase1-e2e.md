# Phase 1 E2E — Breakdown View via Tauri MCP

> Status: **PASS** — full capture → stale → accept-newer → reopen → waive loop verified in the running debug app

- **Date:** 2026-07-18
- **Harness:** Tauri MCP (`mcp__tauri__*`) against `pnpm tauri:dev`,
  driver session on `127.0.0.1:9323` (per `dev-docs/e2e-testing.md` —
  non-AI UI/plumbing surface; VMark MCP not involved).
- **Workspace:** scratch dir with `elena.md` + `scene-12.md`.

## Script and observations

1. **Seed through production IPC** (`webview_execute_js` →
   `window.__TAURI__.core.invoke`): `coherence_capture` for a human save
   of `elena.md`, a model generation of `scene-12.md` with
   `inputs=[{path: "elena.md", role: "direct"}]`, then a human save of
   `elena.md` v2. `coherence_breakdown` returned **1 row,
   `state: "version-stale"`** — captures and staleness live in the real
   app process.
2. **Open workspace window**: `open_workspace_in_new_window` → `doc-0`.
3. **Toggle the panel via the menu event** (`ipc_emit_event
   "menu:breakdown"` with the window-label payload — the same event the
   native menu item emits). Accessibility snapshot of `doc-0` showed the
   `dialog "Coherence Breakdown"` with header + Refresh/Close, the
   artifact group `scene-12.md`, and one row: `elena.md — Version stale`
   with **Accept newer / Revise / Waive** buttons.
   Screenshot: `e2e-breakdown-stale.png` (scratchpad, session-local).
4. **Accept newer** (`webview_interact` click): panel re-projected to the
   empty state — literal text **"Everything coherent"**. The ratification
   appended (verified in the ledger below).
5. **Reopen on further advance**: captured `elena.md` v3 via IPC, clicked
   Refresh — the row returned as `Version stale` (the ratification bound
   to v2, exactly the spec §5.4.3 v0 scope).
6. **Waive with reason** (`webview_keyboard` typed
   "her eyes change with the tide — intentional", Enter): row switched to
   **Waived** and stayed visible, displayed distinctly.
   Screenshot: `e2e-breakdown-waived.png`.
7. **On-disk verification** — `.vmark/ledger/<writer>.jsonl` contained,
   in order: `object-registered` ×2, `transformation` ×4 (2 human saves,
   1 model generation with the direct edge, 1 further save),
   `ratification` (actor `xiaolai` — git `user.name`), `waiver` with the
   typed reason and actor. `elena.md` on disk carries its
   `vmark.id` frontmatter block; `.vmark/` holds `snapshots/` and the
   gitignored `index.db`.

## Notes

- The panel opened via the real menu-event → CommandBus → store path,
  not via store poking — the full toggle wiring is exercised.
- `ipc_execute_command` (the harness's direct-IPC surface) only supports
  the mcp-bridge plugin's own commands; app commands were invoked through
  `withGlobalTauri` in `webview_execute_js`, which is the documented
  fallback and still exercises the production `#[tauri::command]` path.
- Screenshots live in the session scratchpad (not committed — matches
  the gitignored-screenshots convention in `dev-docs/`).
