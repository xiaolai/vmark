# Command Registry Unification — Phased Plan

**Status:** RETHINK → revised 2026-07-23 after Codex review (verdict RETHINK,
4 BLOCKER / 9 MAJOR; all dispositioned here). Phase 0 recon done, one finding
corrected. Not started beyond recon.
**Branch:** `refactor/vmark-core`
**ADR:** `dev-docs/decisions/ADR-017-command-bus-absorbs-the-action-registry.md`
**Unblocks:** ADR-015 `Contribution.commands` (WI-4.1 remainder)

Goal: the Command Palette finds and correctly runs every editing action, and the
editing actions reach the CommandBus through a **shared high-level executor
extracted from the menu** — not through the lower-level `dispatchEditorAction`.

## Guiding constraint

The palette and the menu must run an editing action **identically** — same
unified undo/redo, same gates, same IME/retry. The only way to guarantee that is
for both to call one executor. If a phase tempts a second execution path, stop.

## What the Codex review changed

The first draft routed the bridge through `dispatchEditorAction` and claimed the
menu already does. **It does not** — the menu (`useUnifiedMenuCommands.ts`) uses
`runOrQueueProseMirrorAction`/`runOrQueueCodeMirrorAction` with unified history,
`setHeading`/`paragraph` special-casing, format/focus/forced-source gates, and
tab-bound retry that `dispatchEditorAction` lacks. So the core work is
**extracting the menu executor first**, and the plan is re-sequenced around that.

## Phase 0 — Reconnaissance (done, one finding corrected)

- **WI-0.1 — labels are raw English strings, not i18n keys.** `ActionDefinition.label`
  is `"Bold"`/`"Undo"` (`actionDefinitionsCore.ts:18,32`), barely consumed.
  → the bridge needs ~88 NEW translation keys × 9 locales (`translate-docs`),
  registered as lazy getters. Confirmed.
- **WI-0.2 — `setHeading` is the only parameterized action** (`types.ts:147`),
  six levels. Confirmed.
- **WI-0.3 — CORRECTED.** The earlier claim "menu, toolbar and context menu all
  funnel through `dispatchEditorAction`" was **wrong**. Only the toolbar
  (`UniversalToolbar.tsx:158`) and context menu (`runMenuAction.ts:113`) do. The
  **menu does not** — it calls `runOrQueue*Action` + the adapters directly
  (`useUnifiedMenuCommands.ts:206,245`) with richer semantics. This is the
  BLOCKER that reshaped the plan.
- **WI-0.4 — NEW: the availability axes.** `actionSupportsMode` is mode-only
  (`actionRegistry.ts:56`); real enablement lives in `enableRules.ts` (selection,
  node context, multi-selection, editor availability) plus read-only, non-document
  tab, and format policy in the menu. `when()` must cover these.
- **WI-0.5 — NEW: effective-mode resolution.** The menu resolves surface across
  split mode and forced-source large-file tabs (`useUnifiedMenuCommands.ts:380`),
  not just `uiStore.sourceMode`. The extracted executor must own this.

## Phase 1 — Extract the shared executor (the core)

Pull the high-level execution logic out of the React hook into a plain module,
e.g. `services/editor/runEditorAction.ts`.

| WI | Change |
|---|---|
| WI-1.1 | Extract effective-surface/target resolution (WYSIWYG/Source/split/forced-source), the document/format/read-only/non-document gates, unified undo/redo, `setHeading`/`paragraph` special cases, and the IME-safe captured context + tab-bound retry |
| WI-1.2 | Re-wire `useUnifiedMenuCommands` to call the extracted executor — the hook becomes thin event→executor wiring |
| WI-1.3 | `dispatchEditorAction` is untouched; it stays the toolbar/context-menu low-level path |

**DoD:** the existing `useUnifiedMenuCommands` test suite passes unchanged (the
extraction is behaviour-neutral for the menu); the executor is importable from a
non-React context; `pnpm check:all` green.

## Phase 2 — The command context resolver

| WI | Change |
|---|---|
| WI-2.1 | A single resolver returning `{ mode, effectiveSurface, documentKind, formatId, readOnly, editorAvailable, selection/node context }` from stores synchronously — the axes `when()` needs |
| WI-2.2 | An `actionAvailability(actionId, ctx)` combining `actionSupportsMode`, `enableRules`, read-only, non-document, and format policy |

**DoD:** `actionAvailability("deleteTable", ctx-without-table)` is false;
`actionAvailability("bold", browser-tab-ctx)` is false; unit-tested per axis.

## Phase 3 — The bridge (ActionId → CommandSpec[])

| WI | Change |
|---|---|
| WI-3.1 | An explicit `ActionId → CommandSpec[]` mapping. `setHeading` expands to `.1`…`.6` **from day one**; no un-runnable plain `editor.setHeading` ever registers |
| WI-3.2 | Register each spec: `id: "editor.<id>[.<param>]"`, `title` lazy i18n getter, `category` carried from `ActionDefinition`, `when: ctx => actionAvailability(id, ctx)`, `run` → the Phase-1 executor |
| WI-3.3 | HMR/test-safe registration: preflight ALL ids for collisions before registering any; use ownership-aware `hasCommand`/disposable set (not a module flag — the bus documents why, `CommandBus.ts:83`); survive `_resetCommandBus` |
| WI-3.4 | Bootstrap the bridge at the CommandBus bootstrap site with a real command context supplied by the palette (extend what `CommandPalette.tsx:37,58` passes) |

**DoD:** searching "bold"/"insert table"/"heading 2" returns runnable commands;
double bootstrap and reset+rebootstrap do not throw; no id collides with the 66
existing bus ids (preflight test).

## Phase 4 — Localization + palette UX (core, not deferred)

| WI | Change |
|---|---|
| WI-4.1 | ~88 translation keys (`commands.editor.*`, heading variants) in `src/locales/en/*.json`, then `translate-docs` for the other 8 locales |
| WI-4.2 | Palette renders categories (already supported) and groups the new editor commands; empty-search volume (~154) is scrolled/grouped so it stays usable |
| WI-4.3 | Keyboard/screen-reader: the active descendant scrolls into view (`CommandPalette.tsx:102` currently does not) |

**DoD:** `lint:i18n` passes with the new keys present in all locales; a11y test
asserts the active row scrolls into view on arrow navigation.

## Phase 5 — Gates (ADR-015 D6)

| WI | Change |
|---|---|
| WI-5.1 | Adoption: every `ActionId` maps to ≥1 uniquely-registered `editor.*` command (NOT raw id-subset — heading maps only to `.1`…`.6`) |
| WI-5.2 | Differential through the shared executor: `editor.undo` == unified undo (not native); `editor.setHeading.2` == `menu:` H2; `editor.paragraph` works |
| WI-5.3 | Inapplicability: browser/non-document tab, Source mode, and read-only each hide/refuse the right actions |

**DoD:** all three green; the adoption assertion fails if a new action ships
without reaching the bus.

## Codex disposition summary

BLOCKERs 1–4 (menu ≠ dispatchEditorAction; no `ctx.mode`; dropped gates; IME
timing) → Phases 1–2 (extract executor + real context). MAJORs: action
population/expansion → WI-3.1; multi-axis availability → Phase 2; inert `scope`
→ `when`-based (WI-3.2); parameterized/adoption contradiction → WI-3.1 + WI-5.1;
localization → Phase 4; HMR/collision safety → WI-3.3; DoD rigor → Phase 5;
obsolete legacy-hook cleanup → removed; palette volume/a11y → Phase 4.

## Out of scope

- MCP-bridge and shortcut routing through the bus — later consumers. Until then
  the ADR claims "single **palette** surface", not "single command surface".
- `Contribution.commands` (ADR-015 WI-4.1) — this unblocks it; it lands there.

## Review

This revision should get a second Codex pass before Phase 1 commits, since the
mechanism changed substantially from the reviewed draft.
