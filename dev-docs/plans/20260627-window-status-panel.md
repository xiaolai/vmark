# Window Status Panel (#1057)

Status: **Phase 1 — complete** (DoD met: `pnpm check:all` + `cargo test` green)

Live per-window Claude Code status + one-click jump, from a single panel under
the Window menu. Closes the loop the reporter described: today VMark can switch
windows but is blind to status; this surfaces status *and* navigates.

## Problem

VMark windows are isolated webviews (separate JS state). No single place shows,
across all windows, which one is busy / needs attention, nor jumps to it.

## ADRs

- **ADR-1 — Status sources are the two *reliable* signals only.** (a) VMark's
  AI-genie invocation state (`useAiInvocationStore`: running / error / idle +
  elapsed) and (b) the terminal **bell** (`onBell` → a discrete BEL event; Claude
  Code rings it on turn-end / awaiting-input). We do NOT parse PTY output for a
  run-state (fragile; that's ClauDepot's external job). "Attention" = a bell rang
  while the window was unfocused; cleared when the window is focused.
- **ADR-2 — Rust app-state is the cross-window registry.** Windows are isolated;
  each reports its status via `invoke`, Rust keeps `HashMap<label, WindowStatus>`
  and broadcasts `window-status:changed` (global `app.emit`) so any window's panel
  renders the full set. Registry entry is removed on `WindowEvent::Destroyed`.
- **ADR-3 — Reuse existing seams.** Bell already flows through
  `useTerminalSessions` `onBell` + `terminalAttention.ts`; AI state already lives
  in `useAiInvocationStore`; window focus already exists (`set_focus`). The panel
  follows the `KnowledgeBaseOverlay` docked-panel pattern; the Window-menu toggle
  follows the `knowledge-base` command-bus pattern.

## Work items

- **WI-1.1** Rust: `window_status` module — registry in managed state, commands
  `report_window_status` / `set_window_attention` / `clear_window_attention` /
  `get_window_statuses` / `focus_window`; broadcast on mutation; prune on
  Destroyed. Registered in `lib.rs`. Rust unit tests for the registry reducer.
- **WI-1.2** Frontend `windowStatusStore` — listens to `window-status:changed`,
  seeds from `get_window_statuses`; selectors (no destructuring). Tests.
- **WI-1.3** Reporter `useWindowStatusReporter` (mounted once per window in the
  shell): reports AI-genie state + active-doc name on change; reports attention
  on unfocused bell (hook the existing `onBell` path) and clears it on window
  focus. Tests.
- **WI-1.4** `WindowStatusPanel` + `WindowStatusOverlay` (docked panel): rows of
  doc name + status badge (running/elapsed, error, attention, idle) + current
  marker; click → `focus_window`. Component tests (behavior + ARIA).
- **WI-1.5** Window-menu item `window-status` + uiStore toggle + command-bus
  wiring; i18n keys across all 10 locales; menu-id contract updated.
- **WI-1.6** Docs: `website/guide/` (workspace-management) + shortcuts if a
  binding is added.

## Definition of Done (Phase 1)

- `pnpm check:all` green + `cargo test` green.
- Opening the panel in window A lists B/C with live status; ringing a bell in an
  unfocused B marks B "attention"; clicking B focuses it and clears attention.
- Closing a window removes its row within one broadcast.
- All user-facing strings localized in 10 locales; menu-id contract test passes.
