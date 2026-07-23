# Command Registry Unification — Phased Plan

**Status:** Two Codex passes. Pass 1 RETHINK (mechanism was wrong — routed
through `dispatchEditorAction`); rewritten around extracting the menu executor.
Pass 2 **NEEDS AMENDMENT** (direction validated + feasible; 1 BLOCKER + 6 MAJOR
refinements) — all dispositioned in the phases below. Phase 0 recon done (WI-0.3
corrected). Not started beyond recon; ready to build after this revision.
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

## Phase 1 — Extract the shared *semantic* executor (the core)

Pull the high-level execution logic out of the React hook into a plain module,
e.g. `services/editor/runEditorAction.ts`. Feasible because the logic is already
module-level + store-driven (`dispatchToWysiwygImpl`, `dispatchToSourceImpl`,
`dispatchWithRetry`, forced-source resolution) — the hook only wires `listen()`.

| WI | Change |
|---|---|
| WI-1.1 | Extract the SEMANTIC executor: effective-surface/target resolution (WYSIWYG/Source/split/forced-source), format-policy + mode-capability gates, non-document guard, unified undo/redo, `setHeading`/`paragraph` special cases, IME-safe captured context + tab-bound retry |
| WI-1.2 | **The focus gate does NOT move into the executor** (BLOCKER). `shouldBlockMenuAction()` rejects focus inside `.quick-open` — it would make the palette block its own commands. It stays in the native-menu listener; the executor is invocation-source agnostic |
| WI-1.3 | **Per-window owner/disposer.** Retry timers are currently module-global, cancelled by the hook's `useEffect` cleanup. The executor needs an explicit per-window owner both the menu and the bus share, so one caller's disposal cannot cancel another's pending work |
| WI-1.4 | Re-wire `useUnifiedMenuCommands` to call the executor behind its focus gate; the hook becomes thin listener→executor wiring |
| WI-1.5 | `dispatchEditorAction` untouched — stays the toolbar/context-menu low-level path |

**DoD (RED-first this phase, not deferred):**
- The existing `useUnifiedMenuCommands` suite passes unchanged (extraction is
  menu-behaviour-neutral).
- Executor **parity** tests: `undo` → unified history (not native), `setHeading`
  level, `paragraph`, forced-source and split resolution.
- **Focus-policy** test: a command runs from the focused palette (proves the
  gate is not in the executor); a menu accelerator is still blocked with a modal
  focused (proves it stays in the listener).
- **Tab-ownership** test: the captured origin tab is validated against
  `activeWysiwygTabId`/`activeSourceTabId` before immediate dispatch, on **every
  retry**, and on **queued IME execution** — not only the "editor missing" path.
- Retry-disposal test: disposing one window's executor does not cancel another's
  timers.
- `pnpm check:all` green.

## Phase 2 — The command context + availability policy

| WI | Change |
|---|---|
| WI-2.1 | A single resolver returning `{ mode, effectiveSurface, documentKind, formatId, editorAvailable, selection/node context, multiSelection }` from stores synchronously. Wire the **palette** to supply it — today `CommandPalette.tsx` passes only `{ windowLabel }`, so both `searchCommands` and `executeCommand` need the resolved context |
| WI-2.2 | An **explicit `ActionId → availability descriptor`** (mode support, adapter-action alias, selection/node/multi-selection requirement, mutates-document flag). `enableRules` **cannot be reused directly** — it keys on `ToolbarActionItem.enabledIn` + `CursorContext`, not `ActionId`, and many registry actions have no toolbar item. The descriptor is the action-centric policy the palette needs |
| WI-2.3 | Replace Phase 1's duplicated in-executor gates with this shared resolver, so there is one availability source before the bridge lands |

**DoD:** a **per-axis matrix** test (not just table/browser examples) — every
`ActionId` × {no-selection, in-table, in-link, in-list, multi-selection,
source-only, wysiwyg-only, no-editor} asserts the expected availability;
`deleteTable` outside a table is false; `bold` on a browser tab is false.

## Phase 2b — Read-only (NEW behavior, separate WI)

The menu has **no** read-only gate today, so this is not extraction — it is new
behavior for the palette's `when()`, and must be test-first and precise.

| WI | Change |
|---|---|
| WI-2b.1 | Add a `mutatesDocument` flag to each action's descriptor. Effective read-only is two-part: document read-only **plus** `readOnlyDefault && !editingEnabled` (`SourcePane.tsx:107`) |
| WI-2b.2 | `when()` hides only **mutating** actions under read-only — a blanket block would wrongly hide non-mutating selection/navigation actions |

**DoD:** under read-only, `bold` is hidden but a non-mutating action is not;
tested both ways.

## Phase 3 — The bridge (ActionId → CommandSpec[])

| WI | Change |
|---|---|
| WI-3.1 | An explicit `ActionId → CommandSpec[]` mapping. `setHeading` expands to `.1`…`.6` **from day one**; no un-runnable plain `editor.setHeading` ever registers |
| WI-3.2 | Register each spec: `id: "editor.<id>[.<param>]"`, `title` lazy i18n getter, `category` carried from `ActionDefinition`, `when: ctx => actionAvailability(id, ctx)`, `run` → the Phase-1 executor |
| WI-3.3 | HMR/test-safe registration needs a **real owner API** on the bus. `hasCommand(id)` only answers existence — it cannot distinguish an idempotent re-bootstrap from a foreign collision or a partial prior batch (`CommandBus.ts:60,89`). Add owner metadata (or an atomic batch-register with an owner token + disposer) so the bridge can replace-its-own on HMR, error on a foreign id, recover from a partial batch, and survive `_resetCommandBus`. Preflight ALL generated ids before registering any |
| WI-3.4 | Bootstrap the bridge at the CommandBus bootstrap site with a real command context supplied by the palette (extend what `CommandPalette.tsx:37,58` passes) |

**DoD:** searching "bold"/"insert table"/"heading 2" returns runnable commands;
double bootstrap, HMR replacement, reset+rebootstrap, a **foreign** id
collision, and a **partial** prior batch each behave correctly (test each);
no id collides with the 66 existing bus ids (preflight test).

## Phase 4 — Localization + palette UX (core, not deferred)

| WI | Change |
|---|---|
| WI-4.1 | ~88 translation keys (`commands:editor.*`, heading variants) **plus localized category labels** in `src/locales/en/*.json`, then `translate-docs` for the other **9** locales (10 dirs total: de/en/es/fr/it/ja/ko/pt-BR/zh-CN/zh-TW). Land keys **with or before** the registering bridge so no phase ships raw ids |
| WI-4.2 | Real category **grouping** — the palette currently renders the raw category id per row (`CommandPalette.tsx:173`), not grouped sections. Group the ~154 commands into labelled sections; empty-search volume stays usable |
| WI-4.3 | Keyboard/screen-reader: the active descendant scrolls into view (`CommandPalette.tsx:102` currently does not), and groups are announced |

**DoD:** `lint:i18n` passes with new keys **and category labels** in all 10
locales; a test asserts commands render in labelled groups (not raw ids); a11y
test asserts the active row scrolls into view on arrow navigation.

## Phase 5 — Gates (ADR-015 D6)

| WI | Change |
|---|---|
| WI-5.1 | Adoption: every `ActionId` maps to ≥1 uniquely-registered `editor.*` command (NOT raw id-subset — heading maps only to `.1`…`.6`) |
| WI-5.2 | End-to-end **bus** differential: running `editor.undo` / `editor.setHeading.2` / `editor.paragraph` *through the CommandBus* matches the `menu:` path. (Executor-level parity for these already went RED in Phase 1; this is the full palette→bus→executor path.) |
| WI-5.3 | Inapplicability: browser/non-document tab, Source mode, and read-only each hide/refuse the right actions |

**DoD:** all three green; the adoption assertion fails if a new action ships
without reaching the bus.

## Codex disposition summary

**Pass 1 (RETHINK):** menu ≠ `dispatchEditorAction`, no `ctx.mode`, dropped gates,
IME timing → rebuilt around the extracted executor (Phases 1–2). Population/heading
expansion → WI-3.1; inert `scope` → `when` (WI-3.2); parameterized/adoption
contradiction → WI-3.1 + WI-5.1; localization → Phase 4; obsolete legacy-hook
cleanup → removed.

**Pass 2 (NEEDS AMENDMENT):**
- BLOCKER — focus gate would reject the palette → stays in the menu listener,
  out of the executor (WI-1.2) + RED focus-policy test.
- `enableRules` can't take an `ActionId` → explicit availability descriptor
  (WI-2.2).
- read-only is new behavior, blanket block wrong → separate test-first Phase 2b
  with `mutatesDocument`.
- executor lifetime/tab ownership → per-window owner/disposer (WI-1.3) +
  tab-validation on immediate/retry/IME (WI-1.4 DoD).
- `hasCommand` has no owner → real owner API on the bus (WI-3.3).
- DoD too late → parity/focus/retry/tab tests RED in Phase 1; per-axis matrix in
  Phase 2.
- palette shows raw category ids, 10 locales not 9 → grouping + 9 other locales
  (Phase 4).

## Out of scope

- MCP-bridge and shortcut routing through the bus — later consumers. Until then
  the ADR claims "single **palette** surface", not "single command surface".
- `Contribution.commands` (ADR-015 WI-4.1) — this unblocks it; it lands there.

## Review

Two Codex passes done (RETHINK → NEEDS AMENDMENT, all dispositioned above).
Direction validated and feasible; the amendments are folded into the phases.
**Ready to build** — start at Phase 1 (extract `runEditorAction`), which the
recon confirmed is mostly grouping already-module-level, store-driven functions.
