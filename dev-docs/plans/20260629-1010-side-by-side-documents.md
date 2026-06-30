# Two Documents Side by Side (#1081)

Status: **Phase 0 — design (revised after Codex review 2026-06-29, verdict
NEEDS REVISION → addressed below). Spike not yet started.**

> **Cross-model review (Codex, thread `019f131b-1add-7d02-a4c9-d25159fe877d`,
> 2026-06-29).** Verdict NEEDS REVISION. Critical findings incorporated into the
> ADRs and phasing below: (a) `activeTabId` is writable lifecycle state, not an
> alias-able derived value; (b) editor surfaces aren't tab-scoped today, so
> tab-scoping + pane-keyed `editorStore` are **Phase 1 prerequisites**, not late
> cleanup; (c) singleton search / Tiptap-editor / MCP-write state cross-fire
> across panes; (d) persistence, tab-lifecycle, and drag-out invariants must be
> designed up front (data-loss risk); (e) Phase 0 must be a *vertical* spike;
> (f) MCP already supports explicit `tabId` targeting — preserve it.

Let a window show **two different documents** in resizable panes — for bilingual
reading/translation and keeping a reference open while writing. Distinct from
today's Split View (`Shift+F6`), which is source + preview of the *same* file.

## Problem

VMark shows one document per window. The only way to see two files together is
to open a second window and tile by hand — clunky and never stays put. Obsidian
and VS Code both support in-window split.

## Investigation findings (what makes this hard)

The **layout is trivial** — `SplitPaneEditor`'s divider/CSS is already generic
and content-agnostic (`MarkdownSplitView` takes arbitrary `source`/`preview`
nodes). The cost is entirely **disambiguation**: ~20+ files assume *one active
document per window* via `activeTabId[windowLabel]`. Concretely coupled:

| Subsystem | File(s) | Assumption |
|---|---|---|
| Menu dispatch | `useUnifiedMenuCommands.ts:82-99` | one active tab → menuPolicy |
| MCP bridge | `mcpBridge/v2/document.ts:88-124` (`resolveTab`) | `activeTabId[windowLabel]`; no pane concept |
| Editor refs | `editorStore.ts:30-58` | single `activeWysiwygEditor` / `activeSourceView` |
| Find | `FindBar.tsx` | one per-window search state |
| Status / sidebar | `StatusBar.tsx`, `OutlineView.tsx` | window-scoped, one doc |
| Plugins | `toolbarActions/*`, `sourceImagePopup/*` (15+) | read `activeTabId[windowLabel]` |

Per-window state is already keyed by `windowLabel` (`tabStore`,
`WindowContext.tsx`) — that pattern is the template to extend to panes. Scroll
sync is **not implemented** today (only cursor-sync exists) — a clean add-on.

## ADRs

- **ADR-1 — Pane-aware window model.** Per window: `panes: { primary: tabId,
  secondary: tabId | null }` + `focusedPane: "primary" | "secondary"`. Single-pane
  today = `secondary: null`. Lives in `tabStore` (already window-keyed).

- **ADR-2 — `getFocusedTabId(windowLabel)` is a NEW read API; `activeTabId`
  stays as-is.** (Revised per Codex finding 1.) `activeTabId` remains the
  tab-strip's writable lifecycle state (selection, close-fallback, detach,
  reopen, hot-exit) — it is **not** redefined as a derived alias. New code that
  needs "the document the user is acting on" calls `getFocusedTabId`, which in
  single-pane mode returns `activeTabId[windowLabel]` and in two-pane mode returns
  the focused pane's tab. Consumers migrate explicitly, one call site at a time.
  Clicking a pane/editor (not UI chrome — see ADR-8) sets `focusedPane`.

- **ADR-3 — MCP: omitted `tabId` → focused pane; explicit `tabId` PRESERVED.**
  (Revised per Codex finding 3.) The bridge already lets `document.read/write/
  transform` target any tab by explicit `tabId`, including non-active — that
  stays. Only the *implicit* resolution (no `tabId`) changes from "active tab" to
  "focused pane" via `getFocusedTabId`. View-state tools (`selection.*`) resolve
  the focused pane's live editor. No protocol/sidecar change; an explicit
  `{ pane }` arg remains a deferred, additive v2.

- **ADR-4 — `editorStore` becomes a keyed registry; React via PaneContext,
  non-React via an imperative resolver.** (Revised per Codex findings 2 & 3.)
  The singleton slices (`active*`, `tiptap.editor`, source context, toolbar
  context, debug view) are insufficient for two panes. Replace with
  `editorsByPane` (or `editorsByTab`) registries + `getFocusedEditor(windowLabel)`.
  React descendants read a `PaneContext`; imperative call sites (MCP handlers,
  command services, toolbar adapter utils, the window-level menu dispatcher) use a
  parallel `resolveFocusedEditor()` service — **PaneContext alone cannot reach the
  ~15 non-React call sites.**

- **ADR-5b — One window-wide editor mode for v1.** (New, per Codex finding D2-4.)
  `sourceMode`/`markdownSplitView` stay window-global for v1; both panes share the
  mode. Per-pane mode (e.g. WYSIWYG left, source right) is an explicit non-goal
  for v1, documented as a known limitation. Revisit only if the reference-pane UX
  demands it.

- **ADR-6b — `EditorSurface({ tabId, paneId })`, one window-level menu
  dispatcher.** (Revised per Codex finding 4.) Do NOT mount two `<Editor>`
  instances (each would re-resolve the active tab and duplicate menu listeners).
  Extract a parameterized `EditorSurface` that takes its `tabId`/`paneId`
  explicitly; the menu dispatcher stays single and window-level, routing to the
  focused pane. This requires tab-scoping `useDocumentState` + the Tiptap/Source
  surfaces FIRST (see Phase 1).

- **ADR-8 — Focus retention rules.** (New, per Codex finding D4-4.) Focusing UI
  chrome (FindBar, toolbar, status bar, terminal, modals) must NOT change
  `focusedPane`. Pane focus changes only when a pane's editor gains focus or the
  focused pane closes.

- **ADR-5 — Reuse the existing split layout.** New `DualDocumentPane` hosts two
  `<Editor>` instances, each wrapped in a `PaneContext`, using the existing
  `split-pane-editor.css` divider/resize. No new layout primitive.

- **ADR-6 — Sidebar / Status / Find are focus-aware.** Outline, FindBar, StatusBar
  bind to `focusedPane` (follow focus), not split into two — keeps the chrome
  simple; the focused pane drives them.

- **ADR-7 — Scroll-sync is a separate, opt-in phase.** Proportional
  (ratio-based) scroll sync for bilingual reading is genuinely useful but
  independent; it ships after the core split works.

## Phasing

- **Phase 0 — Vertical spike (governance §7).** (Rescoped per Codex finding R-2.)
  Mount two *real* surfaces (`TiptapEditorInner` + `SourceEditor`) bound to two
  *different* tab IDs in one window, then exercise the actual cross-fire risks:
  a menu command, find/replace, `selection.*` MCP, `document.write` MCP, save
  flush, and undo/redo — verifying each hits the focused pane only. Probe under
  `dev-docs/grills/side-by-side/`. **Gate:** spike PASS before Phase 1.

- **Phase 1 — Pane model + tab-scoping + keyed editor registry (prerequisites).**
  (Expanded per Codex findings F-1, F-2, R-1, R-3.) This is the load-bearing
  refactor, done with single-pane behavior unchanged and fully testable before any
  split UI:
  - `tabStore` pane model (`panes`, `focusedPane`) + `getFocusedTabId`;
    pane-aware reducers with **invariants + table-driven tests** for every tab
    lifecycle op (close primary/secondary/focused, same tab both panes, reorder,
    reopen, pin, dedupe, detach).
  - Tab-scope `useDocumentState` + the Tiptap/Source surfaces (`EditorSurface(
    {tabId, paneId})`); stop resolving `activeTabId` deep in editor hooks.
  - `editorStore` → keyed registry + `getFocusedEditor`; PaneContext (React) +
    `resolveFocusedEditor()` (imperative).
  - Migrate menu/MCP (`document.*`, `selection.*`)/find/status/sidebar to
    focused-pane resolution.
  - **Persistence designed now**: hot-exit schema gains `panes`/`focusedPane`/
    layout fraction + version migration + restore fallback (missing/duplicate/
    stale pane tab IDs); tests. Pane-aware close/detach/**drag-out** invariants
    (extend `TabTransferPayload`) — data-loss-critical.
  - Store/component harness to simulate primary+secondary pane state pre-UI.

- **Phase 2 — Reference pane (second document, capabilities defined).** (Revised
  per Codex findings C-2, A-1.) `EditorSurface`-based split using a small
  *extracted* generic split layout (not `SplitPaneEditor` directly); open a second
  doc beside the first; focus switching; divider resize; layout persists. **The
  secondary pane is fully focusable + selectable + findable + copyable + saveable**
  (passive "read-only preview" was ambiguous and under-covers the bilingual need);
  what it is NOT is a *separate editor mode* (ADR-5b). UX entry points specified:
  command + tab context-menu "Open in side pane", close/swap secondary. Satisfies
  the reporter's core need.

- **Phase 3 — Hardening / parity.** Any remaining singleton seams; full MCP
  write-to-focused-pane parity with a mounted secondary WYSIWYG editor; per-op
  e2e.
- **Phase 4 — Synchronized scrolling (opt-in).** Ratio-based scroll sync toggle;
  gets its own mini-design (folded content, images, source-vs-WYSIWYG).

## Definition of Done (per phase)

- **P0:** spike doc with PASS verdicts on coexistence + PaneContext resolution.
- **P1:** `pnpm check:all` green; single-pane behavior unchanged (regression
  suite); all `activeTabId` consumers in scope route through `getFocusedTabId`.
- **P2:** open two different docs in one window, resize divider, switch focus;
  menu/find/outline follow the focused pane; layout persists across restart;
  missing-file on restore handled. New behavior covered by tests.
- **P3:** edit either pane; MCP write lands in the focused pane and leaves the
  other untouched (e2e). **P4:** sync-scroll toggle holds two docs in proportion.

## Recommendation to reporter

Phase 2 (a reference pane) is the natural first user-visible milestone and covers
the stated bilingual-reading / reference-while-writing need; full dual-edit
(Phase 3) and sync-scroll (Phase 4) follow. Phasing it this way is the *correct*
architecture delivered incrementally — not a throwaway MVP.

## Open Questions (for sign-off)

Resolved by review/decision: MCP routing (ADR-3), per-pane mode (ADR-5b),
editor-surface architecture (ADR-6b). Remaining:

1. Layout axis: left/right only for v1, or also top/bottom? (Reporter offered
   either.) Default: left/right; the extracted split layout supports both later.
2. Re-run Codex review on this revised plan before Phase 1 (recommended, since the
   first pass was NEEDS REVISION — continue thread
   `019f131b-1add-7d02-a4c9-d25159fe877d`), or accept the in-plan revisions and
   proceed straight to the Phase 0 vertical spike?
