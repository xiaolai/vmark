# Command Registry Unification — Phased Plan

**Status:** Two Codex passes. Pass 1 RETHINK (mechanism was wrong — routed
through `dispatchEditorAction`); rewritten around extracting the menu executor.
Pass 2 **NEEDS AMENDMENT** (direction validated + feasible; 1 BLOCKER + 6 MAJOR
refinements) — all dispositioned in the phases below. Phase 0 recon done (WI-0.3
corrected). **Zed cross-check (2026-07-23)** folded in — Zed's shipping palette/
keymap/menu run one dispatch path and enumerate from the same registry they
execute through, confirming this plan's core; three refinements applied to WI-2.2,
WI-3.1, WI-5.1 (see ADR-017 Amendment and
`dev-docs/deep-researches/20260723-zed-architecture-lessons.md`). Not started
beyond recon; ready to build after this revision.
**Branch:** `refactor/vmark-core`
**ADR:** `dev-docs/decisions/ADR-017-command-bus-absorbs-the-action-registry.md`
**Unblocks:** ADR-015 `Contribution.commands` (WI-4.1 remainder)

Goal: the Command Palette finds and correctly runs every editing action, and the
editing actions reach the CommandBus through a **shared high-level executor
extracted from the menu** — not through the lower-level `dispatchEditorAction`.

## Decisions settled (cross-model, 2026-07-23)

A third Codex pass (rule 60 §6) settled the two open scope questions; both models
concur.

- **Surface scope = palette-only (confirmed).** The extracted executor is
  immediately adopted by BOTH the native menu and the palette, so it is not an
  unadopted foundation (ADR-015 D6 satisfied). Routing keyboard shortcuts through
  the bus is a **separate** migration (precedence, held keys, event suppression,
  overlap across native-menu accelerators / React handlers / Tiptap + CodeMirror
  keymaps) and becomes the **next consumer branch** with its own collision / held-
  key / IME / modal-focus inventory. The ADR keeps saying "single **palette**
  surface", not "single command surface".
- **Localization = English-with-the-bridge; other 9 locales + grouping/a11y in a
  mandatory fast-follow branch.** Because this branch is parked and unreleased,
  users never see intermediate states, so the "no phase ships raw ids" rule does
  not justify coupling ~800 translated strings + a palette-render redesign to the
  semantic bridge. English keys prove the machinery. **Binding conditions:**
  (a) English keys land no later than bridge registration; (b) non-English locales
  fall back to **English, never to raw command ids**; (c) the follow-on is
  **mandatory before this unit is declared complete** — not demoted to backlog;
  (d) grouping + a11y acceptance gates live in that follow-on, not dropped.
  Phase 4 below splits accordingly: 4.1-English is in-unit; 4.1-other-locales /
  4.2 / 4.3 are the fast-follow.

## Phase 1 hardening (cross-model, 2026-07-23) — fold into the WIs/DoD below

1. **Capture ownership BEFORE the first dispatch, not after it fails.** Today
   `dispatchWithRetry` captures `originTabId` only once the immediate attempt
   fails, so that first attempt is unvalidated. Capture
   `{ windowLabel, tabId, effectiveSurface, editor/view identity }` up front,
   before undo/redo or editor dispatch (sharpens WI-1.1).
2. **Revalidate ownership at the final mutation boundary** — inside the queued
   ProseMirror/CodeMirror callback (IME runs it later), in addition to before
   every immediate attempt and retry (sharpens the WI-1.4 tab-ownership DoD).
3. **The per-window owner belongs to the window/editor-host lifecycle**, not to
   "menu caller" vs "bus caller"; both surfaces obtain the same owner and only
   that window's disposal cancels its work (sharpens WI-1.3). Test two windows,
   disposal during retry, disposal during IME composition, rapid repeated actions.
4. **The executor is the execution-time correctness defense, not `when()`.**
   Availability (Phase 2) governs *discoverability*; palette context can go stale
   between search and Enter, and menu calls do not arrive with that context. So
   `runEditorAction` must synchronously **re-resolve and enforce**
   document/format/capability/surface/ownership at execution time — `when()` is
   never the sole safety boundary.
5. **Focus gate stays strictly at the native-menu boundary** (WI-1.2) — test both
   directions: a palette command succeeds while `.quick-open` holds focus; a menu
   accelerator is blocked under the same focus condition.

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

**Status: ✅ COMPLETE (2026-07-23)** — `pnpm check:all` green. The executor is
`services/editor/runEditorAction.ts` (split for the size gate into
`runEditorAction.ts` = orchestration + dispatch, `editorActionGates.ts` =
format/capability/mode resolution + adapter-name map, `editorActionOwner.ts` =
per-window retry owner). The hook (`useUnifiedMenuCommands.ts`) is now a thin
listener: window filter → focus gate → `runEditorAction`. All five cross-model
hardenings landed (capture-before-dispatch, IME-deferred ownership revalidation,
per-window owner, execution-time gate enforcement, focus gate at the boundary).
65 existing hook tests stay green (behaviour-neutral extraction) + 24 new
executor tests (parity, gates, IME/retry ownership, owner isolation).

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

**Status: ✅ COMPLETE (2026-07-24)** — `pnpm check:all` green. WI-2.1:
`services/commands/commandContext.ts` (`resolveCommandContext`) resolves the
synchronous context (mode / isDocument / formatId / editorAvailable / selection /
node axes / multiSelection), normalising both `CursorContext` shapes; the palette
now supplies it to `searchCommands`/`executeCommand`. WI-2.2:
`services/commands/actionAvailability.ts` — a closed typed record + evaluator (no
DSL): `isActionExecutable` (executor gate) and `actionAvailability` (palette gate
= executable + editor + node/selection), plus `mutatesDocument` for Phase 2b.
WI-2.3: the executor's inline document/format/mode/capability gates collapsed onto
`resolveCommandContext` + `isActionExecutable` (format-policy extracted to
`editorActionGates.isCategoryAllowedByFormat`; `isActionAllowedForActiveFormat`
removed). Behaviour-neutral (101 executor+hook tests green); per-axis matrix in
`actionAvailability.test.ts` (every ActionId × axes). Node/selection are the
palette's discoverability concern, deliberately NOT enforced by the executor.

**Audit-fix (3 Codex rounds, all check:all green):** multi-selection availability
reuses the adapters' own `getMultiSelectionPolicyForAction` (default-disallow for
unlisted) + a gate-BYPASS set {undo, redo, setHeading, paragraph}; link-in-link
reuses `LINK_DISABLED_ACTIONS`; tests strengthened to real per-axis expectations.
**Two residuals are consciously DEFERRED to Phase 3** (both need the full per-cursor
multi-selection context / per-spec projection the flattened palette context lacks;
neither is a correctness risk — the adapter is the final boundary): (a) the palette
does not reproduce `canRunActionInMultiSelection`'s "all cursors share a structural
context" conditional check, nor (b) its universal vetoes (any range in code/table/
link/image/math/footnote disables every multi-selection action); and the palette
context is resolved per-query, not yet reactive to cursor/editor changes while open
(surfaces only once editor commands are registered).

| WI | Change |
|---|---|
| WI-2.1 | A single resolver returning `{ mode, effectiveSurface, documentKind, formatId, editorAvailable, selection/node context, multiSelection }` from stores synchronously. Wire the **palette** to supply it — today `CommandPalette.tsx` passes only `{ windowLabel }`, so both `searchCommands` and `executeCommand` need the resolved context |
| WI-2.2 | An **explicit `ActionId → availability descriptor`** (mode support, adapter-action alias, selection/node/multi-selection requirement, mutates-document flag). `enableRules` **cannot be reused directly** — it keys on `ToolbarActionItem.enabledIn` + `CursorContext`, not `ActionId`, and many registry actions have no toolbar item. The descriptor is the action-centric policy the palette needs. **(Zed refinement, narrowed by Codex review)** Shape it as a **closed structured record over the typed `ctx`** (fields: mode / selection / node / multiSelection / readOnly / mutatesDocument), evaluated by **one typed function** — **not** a bespoke predicate mini-language. Zed's serialized predicate DSL (`keymap/context.rs:171-324`) earns its parser only because keymaps/extensions serialize conditions; VMark's actions are first-party compiled TS, so a data DSL would add a parser, operator semantics, and drift from the TS types for **no current consumer**. The structured record (not a free-form per-action closure) is what makes the Phase-2 per-axis matrix cheap; WI-3.2's `when: ctx => actionAvailability(id, ctx)` is the single compiled evaluator over it (a closure that *reads* the record — "not a free-form closure" ≠ "no closure"). Keep it pure and cheap (runs on every palette keystroke). Revisit a serialized predicate only if external keymaps / third-party declarative commands ever need it |
| WI-2.3 | Replace Phase 1's duplicated in-executor gates with this shared resolver, so there is one availability source before the bridge lands |

**DoD:** a **per-axis matrix** test (not just table/browser examples) — every
`ActionId` × {no-selection, in-table, in-link, in-list, multi-selection,
source-only, wysiwyg-only, no-editor} asserts the expected availability;
`deleteTable` outside a table is false; `bold` on a browser tab is false.

## Phase 2b — Read-only (NEW behavior, separate WI)

**Status: ✅ COMPLETE (2026-07-24)** — `pnpm check:all` green; audit-fixed (Codex).
`resolveCommandContext` resolves two-part effective read-only (mirrors
`SourcePane`: `document.readOnly` OR `format.readOnlyDefault && !tab.editingEnabled`).
**Audit correction:** read-only is enforced in `isActionExecutable` (the EXECUTOR
gate), not merely hidden in the palette — undo/redo bypass the editor via unified
history and programmatic dispatch isn't reliably blocked by a read-only editor, so
menu shortcuts must be refused too. The executor's deferred (IME/retry) boundary
re-validates read-only (`isWindowReadOnly`) so a mutation can't land after the doc
became read-only. Non-mutating selection/navigation actions stay executable. The
WI-1A.14 cross-format matrix undo/redo assertions are now read-only-aware
(blocked on `readOnlyDefault`/viewer formats — a correct behavior change).

The menu has **no** read-only gate today, so this is not extraction — it is new
behavior for the palette's `when()`, and must be test-first and precise.

| WI | Change |
|---|---|
| WI-2b.1 | Add a `mutatesDocument` flag to each action's descriptor. Effective read-only is two-part: document read-only **plus** `readOnlyDefault && !editingEnabled` (`SourcePane.tsx:107`) |
| WI-2b.2 | `when()` hides only **mutating** actions under read-only — a blanket block would wrongly hide non-mutating selection/navigation actions |

**DoD:** under read-only, `bold` is hidden but a non-mutating action is not;
tested both ways.

## Phase 3 — The bridge (ActionId → CommandSpec[])

**Status: ✅ COMPLETE (2026-07-24)** — `pnpm check:all` green. `editorCommandBridge.ts`
lifts every editor ActionId into the CommandBus: `run` → `runEditorAction`, `when`
→ `actionAvailability`, `title` → lazy `i18n.t("commands:editor.*")` (English keys
in all 10 locales — English placeholders for the 9 non-en, fast-follow translates;
never a raw id, via `defaultValue`), `category` from `ActionDefinition`. `setHeading`
projects to six `editor.setHeading.1..6` rows sharing the one operation — no plain,
un-runnable `editor.setHeading` (WI-3.1/3.2). WI-3.3: the CommandBus gained an
owner API (`registerCommands`/`unregisterOwner`) — atomic batch register with
foreign-collision PREFLIGHT + replace-own (HMR/double-bootstrap/partial-batch/
reset all converge). WI-3.4: bootstrapped in `useCommandBootstrap` with a disposer;
the palette already supplies the resolved context (Phase 2). DoD: searching
"bold"/"insert table"/"heading 2" returns runnable commands; owner scenarios +
no-collision preflight tested.

| WI | Change |
|---|---|
| WI-3.1 | An explicit `ActionId → CommandSpec[]` mapping. `setHeading` expands to `.1`…`.6` **from day one**; no un-runnable plain `editor.setHeading` ever registers. **(Zed framing, sharpened by Codex review)** The six specs are a **palette *projection* over one action *operation***, not six actions. Terminology: the `ActionId` is the string `"setHeading"`; the level is an **invocation parameter**, not part of the id. The executor entry point stays `runEditorAction("setHeading", { level })` (`types.ts:147`), and each `.N` spec's `run` calls it with its level. Zed models this as one typed action built from params (`editor/src/actions.rs:9-15`); the projection exists only because a palette needs six searchable rows. Do not let the six specs become the identity |
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
| WI-5.1 | Adoption: every `ActionId` maps to ≥1 uniquely-registered `editor.*` command (NOT raw id-subset — heading maps only to `.1`…`.6`). **(Zed framing, sharpened by Codex review)** The gate is **structural**, not "reaches the executor" (too dynamic for a D6 gate — WI-5.2's runtime differential already covers heading-2 *execution*). Assert: (a) every `ActionId` has ≥1 projected `editor.*` spec; (b) `setHeading` projects to **exactly** levels 1–6, no gaps/dupes; (c) every projected spec's `run` invokes `runEditorAction("setHeading", { level: N })`; (d) no plain `editor.setHeading` registers. Keeps one identity without inverting into "six independent actions" |
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
