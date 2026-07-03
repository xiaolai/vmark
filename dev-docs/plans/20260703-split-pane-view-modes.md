# Split-Pane View Modes — Source / Split / Preview

Status: **Phase 1 & 2 — complete** (`bash scripts/check-split-view-phase.sh 1` and
`… 2` both green)

Give the split-pane formats (HTML, SVG, Mermaid, JSON, YAML, TOML) a per-tab
**view mode** — Source, Split, or Preview — so a user can collapse the dual
pane down to just the rendered preview (or just the source), instead of being
stuck at today's dual-pane view where the preview tops out at 80% width.

This is the split-pane analogue of what markdown already gets (a single clean
rendered surface). It is deliberately **not** an editable WYSIWYG editor for
HTML — see ADR-2.

## Problem

`SplitPaneEditor` (`src/components/Editor/SplitPaneEditor/SplitPaneEditor.tsx`)
renders `source ▏resize ▏preview` and clamps the split fraction to `[0.2, 0.8]`
(`MIN_FRACTION`/`MAX_FRACTION`). Consequences, verified against code:

1. **No preview-only view.** The preview can never exceed 80% of the pane, so
   there is no way to view a rendered HTML page / SVG / Mermaid diagram
   full-width. For visual formats this is the common case, and it's impossible.
2. **No source-only view for preview-capable formats.** A format *without* a
   preview (txt, code) already renders source full-width automatically
   (`hasPreview ? fraction : 1`), but a format *with* a preview can't be
   collapsed to source-only — you always pay for the iframe/render.
3. **The split fraction is ephemeral.** `fraction` lives in component `useState`
   and resets to `0.5` on every remount / tab switch — there is no persisted
   per-tab view preference to build on.

Markdown, by contrast, has a clean single rendered surface (WYSIWYG). The ask:
bring an equivalent single-pane *render* view to the split-pane formats.

## Non-goals

- **Not** an editable WYSIWYG HTML/SVG editor. Preview stays a read-only render
  (sandboxed iframe for HTML, image for SVG, etc.). Editing happens in Source or
  Split. Building a round-tripping WYSIWYG surface for these formats is an
  order-of-magnitude larger effort and explicitly out of scope.
- **Not** a new `FormatKind`. See ADR-1.
- **Not** native View-menu integration in v1. See ADR-5 (deferred to harmonize
  with the markdown mode-selector plan #1070).

## Relationship to the markdown mode-selector plan (#1070)

`dev-docs/plans/20260629-1000-view-mode-selector.md` (Phase 0, **not started**)
adds WYSIWYG / Source / Split modes and native View-menu checkmarks for
**markdown only** (its ADR-6 explicitly disables the mode items for non-markdown
tabs). The two features are parallel but distinct:

| | Markdown (#1070) | Split-pane formats (this plan) |
|---|---|---|
| Modes | WYSIWYG · Source · Split | Source · Split · Preview |
| "Rendered" pane | **Editable** (ProseMirror) | **Read-only** render |
| Surface | `MarkdownEditorSurface` | `SplitPaneEditor` |
| Mode state | `uiStore` booleans (global) | per-tab `Tab.viewMode` (this plan) |

**Harmonization rule:** keep the vocabulary and shortcut scheme parallel so a
future pass can unify both under one "Editor Mode" View-menu group. This plan
reuses #1070's `F6`/`Shift+F6` bindings by making their handlers format-aware
(ADR-8) — those handlers become the shared dispatch point — but does **not**
depend on #1070 (unstarted): it only *branches before* the existing markdown
`uiStore` logic and leaves the markdown surface untouched. Whichever plan lands
first, the other must preserve the format-aware branch. Native-menu unification
is a shared follow-up once both land.

## ADRs

- **ADR-1 — Per-tab `Tab.viewMode`, not a new `FormatKind`.** View mode is a
  transient UI preference *per open document*, not a property of the format. A
  new `FormatKind: "preview"` would make a format *permanently* preview-only and
  kill editing — wrong for HTML. Instead add an optional
  `viewMode?: "source" | "split" | "preview"` to the `Tab` interface
  (`tabStore.ts:44`), mirroring the existing `editingEnabled` / `activeSchemaId`
  per-tab flags and their `updateTabById` setter. Survives tab switches; no
  format-registry or `Editor.tsx` routing change.

- **ADR-2 — Preview is a read-only render.** The Preview mode mounts the format's
  `genericPreview` / `schemaRenderer` full-width and **unmounts the CodeMirror
  SourcePane**. It is not editable. To edit, the user switches to Source or
  Split. This mirrors VS Code / Obsidian "preview" — and is the reason view mode
  is a `Tab` flag, not a `FormatKind`.

- **ADR-3 — The toggle exists only when the format has a preview.** For
  preview-less formats (txt, `kind:"viewer"` code files), `hasPreview` is false;
  the toggle is not rendered and `viewMode` is inert (the surface stays
  source-only exactly as today). The effective render is
  `hasPreview ? viewMode : "source"`, computed defensively so a stale
  `viewMode:"preview"` on a now-preview-less tab can't blank the editor.

- **ADR-4 — Default is Split, with a user-configurable global default setting.**
  A tab with no explicit `viewMode` falls back to the global
  `formats.defaultViewMode` setting (`defaults.ts:156`), which itself defaults to
  `"split"` — so existing users see no behavior change until they opt in. The
  setting is a single global choice (Source / Split / Preview) surfaced in
  `FormatsSettings.tsx`, applied when a preview-capable tab opens without a
  per-tab override. Resolution order per tab:
  `Tab.viewMode ?? formats.defaultViewMode ?? "split"`, then clamped by ADR-3
  (`hasPreview ? … : "source"`). A **per-format** default map (e.g. SVG→Preview,
  HTML→Split) is a richer follow-up (see Open Questions), not v1.

- **ADR-5 — In-surface segmented control + reused F6/Shift+F6; native menu
  deferred.** The mode control is a segmented `radiogroup` rendered inside
  `SplitPaneEditor` (top-right of the body); the keyboard path reuses the
  existing `F6`/`Shift+F6` bindings (ADR-8). Native View-menu items (Rust
  `CheckMenuItem` + menu-state sync) are **deferred** to a shared follow-up with
  #1070 so we don't ship two competing "mode" menu structures. This keeps v1
  frontend-only (no Rust menu work).

- **ADR-6 — Rendering unmounts the inactive pane.** Source mode unmounts the
  preview slot (as today when `!hasPreview`); Preview mode unmounts `SourcePane`
  (frees CodeMirror + language services + the iframe rebuild-on-keystroke cost is
  irrelevant since source isn't shown — but the preview still re-renders from
  `content`, which is unaffected by unmounting the editor). Split is unchanged.
  The persisted resize `fraction` (ADR-7) only applies in Split.

- **ADR-7 — Persist mode per-tab; leave the resize fraction ephemeral for v1.**
  Only `viewMode` persists (in `Tab`). The split `fraction` stays component-local
  for now; persisting it is orthogonal and can ride the same per-tab mechanism
  later. Documented as a follow-up to avoid scope creep.

- **ADR-8 — Reuse `F6`/`Shift+F6`; make their handlers format-aware. No new
  binding.** The existing `sourceMode` (`F6`) and `markdownSplit` (`Shift+F6`)
  handlers (`useViewShortcuts.ts:184,208`) toggle markdown-only `uiStore` state
  and are inert on split-pane tabs today. Extend both into **format-aware
  dispatchers** keyed on the focused tab's format kind:

  | Key | Markdown (base = WYSIWYG) | Split-pane (base = Split) | Else |
  |---|---|---|---|
  | `F6` | Source ⇄ WYSIWYG (existing) | Source ⇄ Split | no-op |
  | `Shift+F6` | Split ⇄ WYSIWYG (existing) | Preview ⇄ Split | no-op |

  `F6` always means "show Source." `Shift+F6` means "the alternate render
  layout" — Split for markdown (base is the full render), Preview for split-pane
  (base is already Split). Toggle-against-base gives all three split-pane modes
  from two keys and mirrors markdown's model exactly. **No** new shortcut is
  registered, so no rule-41 *addition* — but the shortcut `label`/`description`
  in `shortcuts.ts` should be generalized (they currently say "Markdown …"), and
  the docs updated. The internal ids stay `sourceMode` / `markdownSplit` (renaming
  is churn across menu-id contracts; noted, not done). **Coordination with
  #1070:** whichever lands first, these two handlers become the shared
  format-aware dispatcher; #1070's refactor must preserve the split-pane branch.

## Work items

### Phase 1 — Core state + rendering (frontend, TDD, no UI chrome)

- **WI-1.1** Add `viewMode?: "source" | "split" | "preview"` to the `Tab`
  interface (`tabStore.ts`) and a `setTabViewMode(tabId, mode)` action using the
  existing `updateTabById` pattern (beside `setTabEditingEnabled`). Export a
  `SplitViewMode` type from `src/lib/formats/types.ts` for shared use.
  **Tests (RED first)** in `tabStore.test.ts`: setter updates only the target
  tab; unknown tab id is a no-op (guarded update); default (unset) reads as
  `undefined`.
- **WI-1.2** `SplitPaneEditor` resolves the effective mode as
  `hasPreview ? (Tab.viewMode ?? formats.defaultViewMode ?? "split") : "source"`
  (reads `viewMode` from `tabStore`, the default from `settingsStore`). Render:
  Source → source full-width, no preview slot, no resize handle; Preview →
  preview full-width, **SourcePane unmounted**, no resize handle; Split →
  today's behavior. **Tests (RED first)** in `SplitPaneEditor.test.tsx`: each
  mode mounts/omits the right panes (query by role/testid); per-tab `viewMode`
  overrides the settings default; unset tab falls back to the setting; a
  preview-less format ignores `viewMode:"preview"` and stays source-only;
  schema-selected renderer is used in Preview just as in Split.
- **WI-1.3** Diagnostics/validation gutter behavior across modes: the validation
  gutter belongs to the source pane, so it shows in Source/Split and is absent in
  Preview (no source pane). Confirm the read-only banner (`kind:"viewer"`) still
  renders above the body in all applicable modes. **Tests** for gutter presence
  per mode and banner persistence.

**Phase 1 DoD:** `pnpm check:all` green. `viewMode` is a persisted per-tab flag;
all three modes render the correct pane set; preview-less formats are unaffected;
proven by tests. No UI control yet (modes set via store in tests).

### Phase 2 — UX, shortcut, i18n, a11y, docs

- **WI-2.1** `ViewModeToggle` component + `view-mode-toggle.css` (co-located in
  `SplitPaneEditor/`). A segmented `role="radiogroup"` with three
  `role="radio"` buttons (Source/Split/Preview), rendered only when `hasPreview`,
  reflecting and setting `Tab.viewMode`. Follows component-pattern + focus-
  indicator rules (visible focus, tokens only). **Tests** in
  `ViewModeToggle.test.tsx`: renders 3 options, click sets mode, `aria-checked`
  reflects active mode, hidden when no preview, keyboard (Arrow/Home/End)
  navigation.
- **WI-2.2** Make `F6`/`Shift+F6` format-aware (ADR-8). Extend the `sourceMode`
  and `markdownSplit` handlers (`useViewShortcuts.ts`) to branch on the focused
  tab's format: markdown → existing `uiStore` toggles; split-pane with preview →
  `setTabViewMode` toggle-against-base (F6 ⇄ Source, Shift+F6 ⇄ Preview);
  else → no-op. **Tests**: F6/Shift+F6 toggle the right split-pane mode against
  the Split base; existing markdown behavior unchanged; no-op on
  media/preview-less tabs. No new binding registered.
- **WI-2.3** Global default-view-mode setting (ADR-4): add
  `formats.defaultViewMode: "source" | "split" | "preview"` (default `"split"`)
  to `settingsStore` defaults + type; add a segmented/select control in
  `FormatsSettings.tsx`. **Tests**: default is `"split"`; setter persists; a new
  preview-capable tab honors the setting. Update `shortcuts.ts` `label`/
  `description` for `sourceMode`/`markdownSplit` to be format-neutral (ADR-8).
- **WI-2.4** i18n: add `splitPane.viewMode.{source,split,preview}` +
  `splitPane.viewMode.label` (aria-label) to `src/locales/en/editor.json`, and
  the `formats.defaultViewMode` setting label/options to the settings namespace,
  across all 10 locales. `pnpm lint:i18n` green.
- **WI-2.5** Docs (rule-21): `website/guide/formats.md` — document the
  Source/Split/Preview toggle, that Preview is read-only, and the `F6`/`Shift+F6`
  keys; `website/guide/settings.md` (Formats section) — the new default-view-mode
  setting; `website/guide/shortcuts.md` — generalized `F6`/`Shift+F6` wording.
  `cd website && pnpm build` clean.
- **WI-2.6** Phase-check script `scripts/check-split-view-phase.sh <N>` (copy
  `scripts/check-multi-format-phase.sh` as the template) asserting the per-phase
  DoD machine-checkably (e.g. Phase 1: `Tab.viewMode` present, SplitPaneEditor
  branches on mode, tests exist; Phase 2: toggle component + format-aware
  `F6`/`Shift+F6` + `formats.defaultViewMode` setting + 10 locales + docs). Wire
  WI linkage per rule-60 §2.

**Phase 2 DoD:** `pnpm check:all` green (no Rust in v1 — see ADR-5/ADR-8, so no
`cargo` gate needed). In-app: the segmented control switches
Source/Split/Preview; `F6` toggles Source⇄Split and `Shift+F6` toggles
Preview⇄Split on split-pane tabs while markdown `F6`/`Shift+F6` behavior is
unchanged; the Formats settings default-view-mode control drives new tabs;
Preview shows the render full-width with no source pane; preview-less formats
show no toggle; all strings localized in 10 locales; website builds;
`bash scripts/check-split-view-phase.sh 2` exits 0.

## Edge cases (must have tests)

- Preview-less format (txt, code) with a stale `viewMode:"preview"` → renders
  source-only, no toggle, no blank pane (ADR-3 defensive compute).
- Tab reassigned from a preview-capable to a preview-less format (format change)
  → `effectiveMode` falls back to source; no crash.
- `kind:"viewer"` read-only code with `editingEnabled` false → banner shows;
  Preview mode N/A (no preview) so toggle hidden.
- Schema-detected renderer (JSON `schemaRenderers`) in Preview mode → uses the
  schema renderer, not the generic preview.
- Rapid mode toggling → no listener leak, last mode wins.
- `F6`/`Shift+F6` on a markdown tab → unchanged existing behavior (regression
  guard); on media or preview-less tab → no-op.
- `Shift+F6` from Source on a split-pane tab → Preview (toggle-against-base
  reaches the third mode without passing through Split).
- Empty document in Preview → format's empty-state preview (e.g. html empty div),
  not an error.
- New tab (no `viewMode`) → resolves to `formats.defaultViewMode` (default
  `"split"`) (ADR-4).

## Open questions / follow-ups (not v1)

1. **Per-format remembered default** (e.g. always open SVG/Mermaid in Preview,
   HTML in Split). v1 ships a *single global* `formats.defaultViewMode` (ADR-4);
   turning it into a per-format map is the richer follow-up.
2. **Persist the split `fraction` per-tab** (ADR-7). Same `Tab` mechanism.
2b. **Persist `viewMode` across hot-exit restart.** `createTransferredTab`
   already carries it across window transfer (whole-tab spread), but hot-exit
   (app restart) does not serialize it — unlike its siblings `editingEnabled` /
   `activeSchemaId`, which persist via the hot-exit schema (v3). Adding it needs
   a TS + Rust `TabState` field plus a schema-migration bump (v4), which is out
   of this plan's frontend-only v1 scope (ADR-5). Tracked here; until then a
   restored tab falls back to the global `defaultViewMode` (acceptable, and
   consistent with the deferred split-fraction decision). Found in the
   audit-fix pass (Codex, 2026-07-03).
3. **Native View-menu unification with #1070** — one "Editor Mode" group covering
   both markdown (WYSIWYG/Source/Split) and split-pane (Source/Split/Preview)
   modes, with `CheckMenuItem` state sync. Shared follow-up once both land.

## Risk / Notes

- **Unmounting SourcePane on Preview** (ADR-6) drops CodeMirror state (scroll,
  cursor). Acceptable — Preview is a read-only view; returning to Source/Split
  remounts fresh. If users report lost scroll position, revisit with a
  keep-alive, but don't pre-optimize.
- **No Rust in v1** keeps the change frontend-only and low-risk; the deferred menu
  work is where Windows main-thread cost (see #1070 ADR-3) would apply.
- `role="radiogroup"` vs `tablist`: radiogroup fits "pick one of three view
  states" better than tabs (which imply separate content panels); follow rule-33
  focus indicators either way.
- File-size: `SplitPaneEditor.tsx` is ~215 lines today — the mode branching plus
  extracted `ViewModeToggle` component should keep it well under the 300 baseline;
  put the toggle in its own file from the start.
