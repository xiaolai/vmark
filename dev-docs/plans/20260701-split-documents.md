# Two Documents Side-by-Side in One Window (#1081)

Status: **All phases implemented + plan-audit findings fixed** on
`feat/split-documents`.

## Implementation status (2026-07-01)

- **Phase 1 ✅** — `paneStore`, `PaneContext`, pane-aware `useActiveTabId`.
- **Phase 2 ✅** — editor-singleton registration gated on the focused pane
  (extracted to `useSourcePaneFocus` / `useFocusedPaneTiptapRegistration`).
- **Phase 3 ✅** — `DocumentSplitContainer` + `SplitDivider` (mouse + keyboard),
  `useUnifiedMenuCommands` lifted to once-per-window, `view.toggleSplitDocuments`
  / `view.closePane` / `view.focusOtherPane` commands, pane-aware tab activation.
- **Phase 4 ✅** — `Alt+Mod+\` shortcut; **persistence** as per-machine UI state
  in `localStorage` (keyed by workspace root) via
  `services/persistence/splitLayoutPersistence.ts` + `restoreSplitLayout` on
  workspace open/recent. (Revised from ADR-7's shared-config approach — see
  ADR-7 note.)
- **Phase 5 ✅** — `useSyncPaneScroll` + `view.toggleSyncScroll`.

### Plan-audit findings (all fixed)
- **H2 (ADR-1)** — `tabStore.activeTabId` is now the **focused-pane alias**:
  paneStore owns both panes' tabs by position and mirrors the focused pane's tab
  into `activeTabId`, so all direct readers + the tab-strip highlight (**M2**)
  follow focus with no per-site changes. The mirror includes `null` (a focused
  empty pane clears the alias rather than pointing at the other pane).
- **H1** — `paneStore.handleTabClosed` reconciles at a **single choke point**:
  `tabStore.closeTab` and `tabStore.detachTab` call it after removing a tab, so
  every close/detach path (Cmd+W, dirty/non-dirty, move-to-new-window,
  drag-detach, MCP `close_tab`, …) collapses a split whose pane held the removed
  tab. It is guarded to no-op when the tab is still present (pinned-close
  refusal) or unpaned, so a declined removal never collapses the split.
- **M1 (restore)** — both pane paths are persisted; restore pins the primary
  active first and skips when either file is gone or both resolve to one tab.
- **M3** — `paneStore.removeWindow` wired into `useWindowClose`.
- **M4** — Close-Pane / Focus-Other-Pane commands added.
- **L1** — sync-scroll re-binds on Source↔WYSIWYG mode switch.
- Split toggle is a no-op on the empty Welcome screen (no active document).

### Remaining v1 limitation (documented)
- View-mode flags stay window-global (focused pane); independent per-pane modes
  and a native Rust menu item are follow-ups. A tab context-menu "Open to the
  Side" action is a follow-up (command + shortcut cover the trigger).
- Closing a paned tab **collapses** the split back to a single pane rather than
  promoting the surviving pane's document — the window then shows whatever tab
  `tabStore.closeTab` activates (right neighbor, then left). Promoting the
  survivor is a follow-up UX refinement.

Let the editor area hold **two different documents** at once — left/right (or
top/bottom) panes, each showing its own document, with a draggable divider and
(optionally) synchronized scrolling. This is distinct from the existing
**Markdown Split View** (`Shift+F6`), which is source + live-preview of the
*same* file. Primary use cases from the reporter: bilingual reading/translation
(original | translation) and keeping a reference doc open while writing.

## Problem

VMark shows exactly one document per window. The only way to view two files
together today is to open a second OS window and tile it by hand — fiddly and
disconnected. `Shift+F6` Split View does not help (same file, two
representations).

The **data layer already supports multiple live documents**: `documentStore`
and `tabStore` are keyed by `tabId`, so two documents coexist in state today.
The blockers are two assumptions baked across ~a dozen hooks and the
toolbar/editor-registration path:

1. **"One active document per window."** `src/hooks/useDocumentState.ts`
   `useActiveTabId()` returns `state.activeTabId[windowLabel]` — a single value.
   **Every** `useDocument*` hook derives from it. So only one document can be
   *active*, even though two can be *loaded*.
2. **"One editor instance per window."** `src/stores/editorStore.ts` is a
   singleton (`active.activeWysiwygEditor`, `tiptap.editor`, `source.editorView`,
   …); editors self-register on mount/focus (`TiptapEditor.tsx`, `SourceEditor.tsx`).
   The toolbar (`UniversalToolbar`) and find bar act on that one registered
   editor. `uiStore` view flags (`sourceMode`, `focusModeEnabled`, the `search`
   slice) are single per-window values, applied as window-level CSS classes in
   `App.tsx`. Two panes would clobber these — last-focused wins.

**Reusable as-is:** `documentStore`/`tabStore` multi-doc keying;
`src/components/Editor/SplitPaneEditor/split-pane-editor.css` layout (flex
`__body` + fraction CSS var); `src/hooks/useSidebarResize.ts` mouse-drag
mechanics; the `isInternalChange` echo-guard pattern in `useSourceEditorSync.ts`.
**Must change:** the two assumptions above. **Net-new:** a draggable
doc-vs-doc divider, ratio-based scroll sync, split-layout persistence.

## ADRs

- **ADR-1 — A per-window pane registry; keep `activeTabId` as the focused
  pane's alias.** Introduce a pane model (max **2** panes for v1: `primary`,
  `secondary`). Store in a new `paneStore` (or a `panes` slice on `tabStore`)
  keyed by window: `{ layout: "single" | "split", orientation: "horizontal" |
  "vertical", fraction, panes: PaneEntry[], focusedPaneId }`, where
  `PaneEntry = { id, activeTabId }`. **Crucially**, keep
  `tabStore.activeTabId[windowLabel]` working as a *derived alias of the focused
  pane's `activeTabId`*, so the ~dozen existing `useActiveTabId()` consumers keep
  functioning unchanged until they are parametrized (ADR-2). No big-bang.

- **ADR-2 — Parametrize document access via `PaneContext`, not prop-threading.**
  Add a React `PaneContext` that provides the current pane's `tabId`. Make
  `useDocument*` read the pane's tab when rendered inside a pane, falling back to
  `useActiveTabId()` (focused pane) when no context. This avoids threading a
  `tabId` prop through every call site — the same pattern `WindowContext` already
  uses for `windowLabel`. `Editor.tsx` takes an optional `tabId` prop and mounts
  `useUnifiedMenuCommands` **once per window** (lift it out of the per-pane path).

- **ADR-3 — De-singleton the active editor by pane; expose "focused pane's
  editor."** `editorStore` tracks registered editors per `paneId`; the toolbar /
  find bar consume a `selectFocusedPaneEditor` read-model. `TiptapEditor` /
  `SourceEditor` register under their pane id.

- **ADR-4 — v1 view-mode flags stay window-global; per-pane view modes are a
  follow-up.** `sourceMode` / `focusMode` / find apply to the **focused pane**
  for v1 (the window-level CSS classes in `App.tsx` move to per-pane class
  application). True independent per-pane view modes (one side Source, other
  WYSIWYG) is desirable but deferred to keep v1 tractable — documented as a known
  limitation. (cursor/content/dirty/selection are already per-tab, so they need
  no duplication — only ADR-2's pane-scoped reads.)

- **ADR-5 — One draggable divider component, combining existing pieces.** New
  `DocumentSplitContainer` renders two `<Editor>`s + a divider that merges
  `split-pane-editor.css` layout + the keyboard a11y from `SplitPaneEditor`'s
  `role="separator"` handler + mouse-drag from `useSidebarResize`.

- **ADR-6 — Sync scroll is opt-in and ratio-based, behind the
  `isInternalChange` echo guard.** Map `scrollTop / scrollHeight` across panes;
  guard against feedback. Off by default; a per-split toggle.

- **ADR-7 — Persist split layout as per-machine UI state in `localStorage`.**
  Original plan: an additive `splitLayout` field in `WorkspaceConfig` (TS + Rust
  round-trip). **Revised during Phase 4:** the split layout is per-machine UI
  state (like window size), not shared project config — persisting it in the
  `.vmark` config would leak one machine's pane layout to collaborators and grow
  baselined Rust/store files past the file-size gate. Instead it lives in
  `localStorage` keyed by workspace root (`vmark-split-layout:<rootPath>`),
  storing `{ orientation, fraction, syncScroll, primaryPath, secondaryPath }`.
  Both pane paths are persisted so restore is deterministic — inferring the
  primary from "whichever tab is active after restore" could collide with the
  secondary and drop the real primary from view. Absent key ⇒ single-pane
  (back-compat). Written by `workspaceSession.ts`; restored by
  `restoreSplitLayout` after tabs load, best-effort (skipped if either file is
  gone or both paths resolve to the same tab).

## Phases

### Phase 0 — Spike (governance §7)
Validate the riskiest assumption with a runnable probe under
`dev-docs/grills/split-documents/`: that `PaneContext` + a derived
`activeTabId`-alias lets the existing `useDocument*` consumers keep working while
a second pane reads a *different* tabId. **DoD:** a throwaway probe renders two
`MarkdownEditorSurface`s bound to two different tabIds, each showing its own
content, with no change to unrelated consumers. PASS gates Phase 1.

### Phase 1 — Pane model + parametrized document access
`paneStore` (or tabStore `panes` slice) + `PaneContext`; `activeTabId` becomes
the focused pane's alias; `Editor.tsx` accepts a `tabId` prop; `useDocument*`
become pane-aware; `useUnifiedMenuCommands` lifts to once-per-window.
**DoD:** single-pane behavior byte-for-byte unchanged (all existing tab/editor
tests green); new `paneStore` tests; `useActiveTabId` returns the focused pane.

### Phase 2 — De-singleton the active editor
`editorStore` per-pane registration + `selectFocusedPaneEditor`; toolbar/find
target the focused pane; window-level CSS classes (`App.tsx`) move to per-pane.
**DoD:** toolbar/find act on the focused pane in a two-pane harness; editor
registration tests cover focus switching; single-pane unchanged.

### Phase 3 — Split UI + draggable divider
`DocumentSplitContainer` with two `<Editor>`s and a mouse-+keyboard divider;
**"Toggle Split Documents"** command (palette + `Alt+Mod+\` shortcut);
**"Close Pane" / "Focus Other Pane"** commands. Wire into `App.tsx` `MainLayout`
`primary` slot.
**DoD:** open two files side-by-side; drag + keyboard resize; close pane returns
to single; a11y (separator role, focus order); component tests.
**Deferred to follow-up (not part of the ✅):** a native View-menu item and a
tab context-menu "Open to the Side" action — the palette command + shortcut
cover the trigger for v1 (see "Remaining v1 limitation" above).

### Phase 4 — Persistence + menus/shortcuts
Split layout persisted in `localStorage` (ADR-7) + restore; frontend shortcut
`Alt+Mod+\` (no native menu accelerator — frontend-only, per the deferred menu
item above).
**DoD:** split layout survives workspace close/reopen; shortcut docs updated;
restore tests.

### Phase 5 — Synced scrolling (optional)
Ratio-based scroll sync with echo guard; per-split toggle (default off).
**DoD:** scrolling one pane drives the other proportionally; no feedback loop;
toggle persists; tests for the ratio mapping + echo guard.

## Risks / Known limitations

- **Pervasiveness.** ADR-2 touches many `useDocument*` call sites; the
  `PaneContext`-fallback design contains the blast radius but Phase 1 is the
  highest-churn phase — keep single-pane green at every step.
- **v1 ships window-global view modes** (ADR-4): both panes share Source/WYSIWYG
  mode and a single find session scoped to the focused pane. Per-pane view modes
  are a documented follow-up, not a v1 deliverable.
- **Two ProseMirror/CodeMirror instances** per window — watch memory/perf on
  large docs; the existing `keepBothEditorsAlive` / large-file source-forcing
  logic must be reconciled per pane.

## Out of scope (v1)
- More than two panes / arbitrary grids.
- Per-pane independent view modes (Source on one side, WYSIWYG on the other).
- Cross-window pane drag.

## Cross-references
- Feasibility map: this plan's findings (architecture survey, 2026-07-01).
- Predecessor: `dev-docs/plans/20260629-1000-view-mode-selector.md` (#1070) and
  the line-numbers decoupling (#1082) clarified the View-menu/editor split that
  ADR-4's per-pane flags build on.
- Governance: `.claude/rules/60-ai-governance.md` (WI linkage, phase DoD,
  cross-model review before Phase 1 since this is >3 phases).
