# View Menu Mode Selector + Toggle Correctness (#1070)

Status: **Phase 0 — planned** (not started)

Fix the three issues @bet4it reported with the View menu's editor-mode toggles,
the architecturally-correct way: model the three modes as one mutually-exclusive
state, reflect the active mode natively in the menu, and make Word Wrap / Line
Numbers honest about where they apply. Also fixes one real functional bug found
during investigation.

## Problem

VMark's markdown editor has three mutually-exclusive modes — **WYSIWYG**
(default), **Source Code** (`F6`), **Markdown Split View** (`Shift+F6`) — but the
View menu mispresents them (verified against code):

1. **No active-state feedback.** `menu/localized.rs:546` uses a plain `MenuItem`
   for `source-mode`; the label is a static i18n string. The codebase has **zero**
   use of `CheckMenuItem` / `set_checked` / `set_text`. A user in Source mode sees
   the same "Source Code Mode" label as in WYSIWYG and can't tell what's active.
2. **Word Wrap / Line Numbers shown where they don't apply.** Both are always
   enabled. Word Wrap only drives CodeMirror (`useSourceEditorSync.ts:165`) — no
   effect in WYSIWYG. "Line Numbers" in WYSIWYG only toggles a `.show-line-numbers`
   CSS class on code blocks (`TiptapEditor.tsx:208`), a different feature from the
   source-editor gutter.
3. **Mutual exclusivity is invisible.** `uiStore.ts:319-322` enforces exclusivity
   (`toggleSourceMode` clears `markdownSplitView` and vice-versa) via **two
   booleans**, but the menu shows two independent toggles with no grouping.

**Bonus bug (not in the report, found en route):** Markdown Split View hardcodes
`EditorView.lineWrapping` (`SplitPaneEditor/sourcePaneExtensions.ts:108`),
unconditionally — the user's Word Wrap toggle is silently ignored in Split View.

## ADRs

- **ADR-1 — A derived `editorMode` read-model, NOT a storage refactor.** The two
  booleans are *already* mutually exclusive at their only mutators
  (`uiStore.ts:319-322` — each toggle clears the other), so illegal "both true"
  states are not actually reachable. Replacing them with a single stored
  `editorMode` field would touch 26 non-test consumers for marginal benefit — a
  drive-by refactor the project rules warn against. Instead add a **pure derived
  selector** `selectEditorMode(s) → "wysiwyg" | "source" | "split"` (mirrors the
  existing `selectSourceEditing` pattern) as the canonical read-model the menu-sync
  hook consumes. The booleans stay as the stored mutators; no consumer churn.

- **ADR-2 — Native macOS radio group, not a relabel or a submenu.** Model the
  three modes as three `CheckMenuItem`s in the View menu — `wysiwyg-mode` (new),
  `source-mode`, `markdown-split` — with the active one checked. This is the
  Finder *View → as Icons / List / Columns* idiom: it makes the active mode and
  the mutual exclusivity obvious natively (resolves issues 1 and 3 at once)
  without dynamic relabeling (issue's "WYSIWYG Mode" suggestion) or a nested
  submenu (worse discoverability, extra click). A new top-of-View "Editor Mode"
  separator groups them visually.

- **ADR-3 — Reverse menu-state sync mirrors `accelerators.rs`.** The menu needs
  to follow store state (mode change → checkmark moves). Add `menu/menu_state.rs`
  modeled exactly on the proven `accelerators.rs` differential pattern: a
  `sync_view_menu_state` command walks the live menu tree, sets `checked` /
  `enabled` per item, backed by a `MENU_STATE_CACHE` diff so each change is ~1
  main-thread hop, not a full rebuild. `collect_kind` in `accelerators.rs` is
  extended to also index `MenuItemKind::Check` (today it ignores Check items —
  otherwise the new CheckMenuItems' accelerators would stop updating, a
  regression on `F6` / `Shift+F6` / `Alt+Z` / `Alt+Cmd+L`).

- **ADR-4 — Word Wrap & Line Numbers are *disabled* (greyed), not hidden, when
  they don't apply.** Enabled iff `editorMode !== "wysiwyg"`. Disabling (vs
  hiding) keeps the menu stable and signals "not applicable here" — the standard
  macOS idiom; hidden items make menus jump. Plus the Split-View functional fix:
  wrap `EditorView.lineWrapping` in a Compartment driven by `wordWrap`, parallel
  to `useSourceEditorSync`.

- **ADR-5 — "Code-block line numbers in WYSIWYG" is decoupled, not regressed.**
  Disabling the gutter "Line Numbers" item in WYSIWYG would remove today's
  code-block line-number toggle there. That conflation is exactly what issue 2
  flags. **Decision needed (see Open Questions):** move code-block line numbers to
  a code-block-local affordance / markdown setting (follow-up), or keep a
  WYSIWYG-only path. Default in this plan: treat the View-menu item as
  *source-gutter* line numbers only; track code-block gutters as a separate
  follow-up so we don't silently drop the feature.

- **ADR-6 — Modes apply to markdown documents only.** For non-markdown tabs
  (yaml-workflow, viewers) the three mode items and Word Wrap / Line Numbers are
  disabled. The sync hook reads the focused tab's `kind` (format config) and
  gates accordingly.

## Work items

### Phase 1 — Frontend correctness (no Rust; lands the functional fixes)

- **WI-1.1** Add pure `selectEditorMode(s) → "wysiwyg" | "source" | "split"`
  read-model selector (beside `selectSourceEditing`). No storage change. **Tests**
  (RED first): all three mappings + that it stays correct under the existing
  exclusive toggles.
- **WI-1.2** Split View word-wrap bug: Compartment-wrap `EditorView.lineWrapping`
  in `SplitPaneEditor/sourcePaneExtensions.ts`; sync to `wordWrap` like the
  source editor. **Test**: extension reconfigures on toggle.
- **WI-1.3** Any in-app UI affordance for Word Wrap / Line Numbers (toolbar,
  command palette gating) reflects "disabled in WYSIWYG". **Tests** as applicable.

### Phase 2 — Native menu state (Rust + bridge + i18n + docs)

- **WI-2.1** `menu/localized.rs`: add `wysiwyg-mode` item; convert `wysiwyg-mode`
  / `source-mode` / `markdown-split` to `CheckMenuItem`; group under an
  "Editor Mode" heading/separator. Update `en.yml` + all 9 other locales with the
  new `menu.view.wysiwygMode` label.
- **WI-2.2** `menu/accelerators.rs`: extend `collect_kind` to index Check items so
  their accelerators keep updating (regression guard). **Rust test**.
- **WI-2.3** `menu/menu_state.rs` (new): `sync_view_menu_state(mode, word_wrap,
  line_numbers, applies)` differential checked/enabled updater + `MENU_STATE_CACHE`;
  register command in `lib.rs`. **Rust tests** mirroring `accelerators` diff tests
  (checked diff, enabled diff, empty/no-op, unknown-id skip).
- **WI-2.4** Frontend sync hook (`useViewMenuStateSync`): subscribe to
  `editorMode`, `wordWrap`, `showLineNumbers`, and focused-tab `kind`; invoke
  `sync_view_menu_state` debounced (~100 ms, like the shortcut store). **Tests**:
  invoke contract (command name + arg keys), debounce, mode→checked mapping,
  WYSIWYG→disabled mapping.
- **WI-2.5** Docs: `website/guide/features.md` (editor modes section);
  `website/guide/shortcuts.md` only if a binding changes (it does not — `F6` /
  `Shift+F6` unchanged; new `wysiwyg-mode` has no accelerator). Keep rule-41 trio
  in sync; rule-21 website sync.

## Definition of Done

**Phase 1:** `pnpm check:all` green. Toggling Word Wrap in Split View now changes
wrapping. `editorMode` is the single source of truth; exclusivity proven by test.

**Phase 2:** `pnpm check:all` + `cargo test` green. In-app: switching modes moves
the checkmark among WYSIWYG / Source / Split; Word Wrap & Line Numbers grey out in
WYSIWYG and re-enable in Source/Split; `F6` / `Shift+F6` still work and their
accelerators still update via the shortcut editor. All strings localized in 10
locales; menu-id contract test passes.

## Decisions (signed off 2026-06-29)

1. **ADR-2 → DECIDED: flat radio group.** Three flat `CheckMenuItem`s in the View
   menu (Finder idiom), not a submenu.
2. **ADR-5 → DECIDED: decouple, track separately (follow-up #1082).** The
   View-menu "Line Numbers" item is source-gutter only and disables in WYSIWYG.
   Code-block line numbers in WYSIWYG move to a code-block-local setting in
   **#1082** — no silent loss, just relocated. The disable only governs the
   *gutter* meaning of the menu item; the existing `.show-line-numbers`
   code-block rendering path is untouched until #1082 lands.

## Risk / Notes

- Windows main-thread cost: the differential sync (ADR-3) is the mitigation;
  never rebuild the menu for a checkmark. Mirrors the Issue #825 fix rationale in
  `accelerators.rs`.
- `CheckMenuItem` is in `tauri::menu` (Tauri v2) — no new dependency.
