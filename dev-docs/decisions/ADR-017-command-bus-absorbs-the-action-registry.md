# ADR-017: The Command Bus Absorbs the Action Registry

> Status: **Proposed** | Date: 2026-07-23
> Depends on: ADR-012 (command bus as single intent path — **drifted**, see
> `dev-docs/audit/20260722-adr-reality-audit.md`)
> Unblocks: ADR-015 `Contribution.commands` (a format/extension contributing a command)

## Context

The 2026-07-22 reality audit found ADR-012 drifted to near-false: the Command
Palette **cannot find "bold"**. Typing an editing action's name returns nothing,
because VMark has two command surfaces that do not meet.

Measured 2026-07-23:

| Surface | What it is | Count | Consumed by |
|---|---|---|---|
| **CommandBus** (`services/commands/CommandBus.ts`) | `register`/`execute`/`search` over `CommandDefinition` (id, title, `run`, `when`, scope) | 66 `registerCommand` sites (mostly view/file/workspace commands) | **the Command Palette** (`searchCommands`), plus menu/shortcut/MCP paths |
| **Action registry** (`plugins/actions/`) | The editing surface — 83 `ActionDefinition`s (bold, italic, headings, tables, lists, undo…). **Metadata only**, no `run` | 83 typed `ActionId`s | the native menu, via `useUnifiedMenuCommands` |

`ActionDefinition` carries `{ id, label, category, supports }` — no executor.
Execution is inline in the menu hook (`useUnifiedMenuCommands.ts`): a `menu:*`
listener resolves effective mode, gates on format policy and capability, routes
undo/redo through unified history, and dispatches to the editor adapters via
`runOrQueueProseMirrorAction`/`runOrQueueCodeMirrorAction` behind the IME guard.
(`dispatchEditorAction` is a *separate*, lower-level path used by the toolbar and
context menu — see the Correction below; the earlier draft wrongly said the menu
uses it.)

So the palette's `searchCommands` reads only the CommandBus map, and the 83
editing actions are not in it. There is **no bridge** — `grep` for
`actionRegistry`/`dispatchAction`/`@/plugins/actions` under `services/commands/`
returns nothing but the CommandBus header comment.

## The reframing

This is **not** "two competing registries, pick a winner." CommandBus's own
header already states the intended layering:

> *"Foundation-only: the existing `actionRegistry` data layer continues to back
> the menu dispatcher. CommandBus adds the missing layer above it — a generic
> register/execute/search surface that downstream code can adopt incrementally."*

CommandBus is the intended **top** surface; the action registry is a **data
layer** meant to feed it. The layering was designed; the **adapter that lifts
actions into the bus was never built.** That is the whole gap.

This matches every drift this session's ADR audit found: a foundation declared,
never adopted, with no gate to notice.

## Correction (2026-07-23, Codex review)

The first draft of this ADR — and the Phase 0 recon that fed it — got the
execution model **wrong**, and the Codex cross-model review (rule 60 §6) caught
it before any code was written. The error and its consequence:

> The native menu does **not** route through `dispatchEditorAction`. The menu
> (`useUnifiedMenuCommands.ts`) calls the editor adapters through
> `runOrQueueProseMirrorAction`/`runOrQueueCodeMirrorAction` and adds semantics
> `dispatchEditorAction` lacks: unified cross-mode undo/redo
> (`performUnifiedUndo/Redo`), special `setHeading`/`paragraph` handling,
> focus / format-policy / mode-capability / forced-source gates, and an IME-safe
> captured context with tab-bound retry. (The menu has no read-only gate — that
> is a *new* concern for the palette.) `dispatchEditorAction` is the
> **lower-level toolbar** path.

So "the adapter reuses the existing menu path via `dispatchEditorAction`" was
false. Routing the palette through `dispatchEditorAction` would break undo/redo
(native per-editor instead of unified), break `paragraph` (no adapter handles
it), and let a palette action mutate a hidden editor on a browser tab. The recon
claim that there was "no async hazard" was also wrong.

## Decision (revised)

**CommandBus is the single command surface for the palette. The editing actions
reach it through a shared high-level executor extracted from the menu — not
through `dispatchEditorAction`.**

The real prerequisite is to **extract the menu's high-level *semantic* execution
logic** out of the React hook `useUnifiedMenuCommands` into a plain, non-React
module that owns:

- effective-surface resolution (WYSIWYG / Source / **split** / forced-source for
  large-file tabs — not just `sourceMode`),
- format-policy and mode-capability gates, and the non-document-tab guard,
- unified cross-mode undo/redo, and the `setHeading`/`paragraph` special cases,
- an IME-safe captured context with the tab-bound retry the menu already does.

**The focus gate stays OUT of the shared executor** (Codex BLOCKER). The menu's
`shouldBlockMenuAction()` rejects focus inside any modal — including the palette
(`.quick-open`). It is a *menu-accelerator* concern ("don't fire a menu shortcut
while a dialog owns input"), not a semantic one. The palette has already decided
to run the command, so it must not be re-gated by focus. The focus check stays in
the native-menu listener wrapper; the shared executor is invocation-source
agnostic. **Read-only is likewise not extracted** — the menu has no read-only
gate today, so adding one is *new behavior* for the palette's `when()`, tracked
as its own test-first WI, not folded into the behaviour-neutral extraction.

Then **both** the native menu and a CommandBus adapter call that shared executor.
`dispatchEditorAction` remains the lower-level toolbar/context-menu path,
unchanged.

For each action, register command(s) via an explicit `ActionId → CommandSpec[]`
mapping (so `setHeading` expands to six from day one), each with:

- `id` = `editor.<actionId>` (namespaced; **collisions are preflighted and
  tested, not assumed impossible** — the bus throws on duplicate id)
- `title` = a real i18n **getter** (`() => t("commands:editor.<id>")`) — new
  keys, because `ActionDefinition.label` is a raw English string, not a key
- `when(ctx)` = the action's **full** availability, resolved from a proper
  command context (mode is only one axis — selection, node context, editor
  availability, read-only, and format policy all gate real actions;
  `actionSupportsMode` alone is insufficient)
- `run` = call the shared executor with the action id + params

### Why this direction, not the reverse

Making the action registry the single surface is still rejected — the bus has
`run`/`when`/`title`/`search` and the palette already consumes it. But the
lift is bigger than first stated: it is not a thin generated adapter, it is
**extracting the menu executor first**, then adapting on top. That extraction is
the core work, and it is worth doing because it also removes the menu's logic
from a React hook where nothing else can reach it.

## Consequences

**Good**
- The palette finds every editing action — the ADR-012 promise, finally true.
- **Unblocks ADR-015 `Contribution.commands`**: with editing actions bus
  commands, a format/extension contributes a `CommandDefinition` the same way.
- The menu's execution logic leaves the React hook and becomes a plain module
  the palette, a shortcut, MCP, or a test can all call — a real decoupling win
  beyond the palette itself.
- One execution path stays authoritative — but it is the **shared extracted
  executor**, not `dispatchEditorAction`.

**Costs / risks**
- **The extraction is the bulk of the work.** Pulling surface resolution, gates,
  unified history, special-casing, and IME/retry out of a 400-line React hook
  without regressing the menu is delicate and needs the menu's existing tests as
  a safety net.
- **Availability is multi-axis.** `actionSupportsMode` (mode only) is
  insufficient — `enableRules.ts` gates on selection, node context
  (link/list/table/blockquote/code), multi-selection, editor availability,
  read-only, and format policy. `when` must reflect these, or the palette offers
  "Delete Table" outside a table. And `executeCommand` returns `true` on mere
  dispatch, so `when` is the *only* real gate — a no-op is invisible.
- **Localization is new work.** `ActionDefinition.label` is a raw English string,
  not a key, so ~83 (88 with heading expansion) new translation keys × 9 locales
  are needed (`translate-docs`). Titles register as lazy getters. No English
  hardcoded fallback — that violates the repo i18n rule.
- **Registration must be HMR/test-safe.** The bus documents why a module flag is
  not HMR-safe and breaks `_resetCommandBus`; use ownership-aware `hasCommand` or
  a disposable registration set, and preflight all ids before partial
  registration.
- **`scope` is inert.** `searchCommands` never reads `CommandDefinition.scope`
  (only `when`), so scoping editor commands away from browser tabs must be done
  in `when`, not `scope`.
- **Palette volume/a11y.** 66 + 88 ≈ 154 commands; empty search lists all, and
  the palette renders every row without scrolling the active descendant into
  view. Category grouping and virtualized/scrolled navigation belong in the core
  phases, not deferred — and `ActionDefinition.category` must be carried, not
  dropped.

## Verification gates

- Searching the palette for "bold", "insert table", "heading 2" returns a
  runnable command (contract test against `searchCommands`).
- **Differential through the shared executor:** `editor.undo` from the bus does
  the same *unified* undo as `menu:undo` (not native per-editor); `editor.setHeading.2`
  == `menu:` heading-2; `editor.paragraph` works. Undo/redo, headings, and
  paragraph are explicit cases, because these are exactly where
  `dispatchEditorAction` would have diverged.
- **Adoption:** every `ActionId` maps to ≥1 uniquely-registered `editor.*`
  command (NOT a raw id-subset — `setHeading` maps only to `.1`…`.6`). Asserted
  in CI per ADR-015 D6.
- A palette on a browser / non-document tab, in Source mode, or read-only does
  not offer or run an inapplicable editing action.
- Duplicate-id preflight: all generated ids are collision-checked before any
  registration; HMR/test re-bootstrap does not throw (ownership-aware, not a
  module flag).

## Amendment (2026-07-23): Zed cross-check

Zed (v1.14.0) solved a version of this problem — a mature editor whose command palette,
keymap, and menus all reach every editing action — so its system was read as prior art
(`dev-docs/deep-researches/20260723-zed-architecture-lessons.md`, `file:line`-anchored).
It **supports this ADR's invariant** and offers three refinements (two of which Codex's
cross-model review then narrowed — see the trailing notes). Boundary: Zed is native
Rust/GPUI; its link-time action registration (`inventory`), `TypeId` identity, and
per-frame native dispatch tree do **not** transfer to React/DOM — VMark keeps a single
string id per action and derives context on demand from Tiptap state. The transferable
part is narrow and architecture-level: *enumeration and execution should share one
authoritative source, and palette/menu/keymap should converge on common invocation
semantics* — not Zed's specific dispatch-tree machinery.

**Confirmed — the single execution path is real and load-bearing.** In Zed, a keybinding,
the palette, and a native menu all funnel through one function
(`Window::dispatch_action_on_node`, `window.rs:5321`); the palette's confirm re-focuses
the prior element and calls the *same* `dispatch_action` a keystroke uses
(`command_palette.rs:620-622`). There is **no separate palette executor**. This supports
this ADR's guiding constraint — palette and menu must run an action identically through
one executor. And Zed's palette enumerates from the *same* dispatch tree it executes
through (`window.available_actions` → `key_dispatch.rs:363`), never a second list — the
property VMark's plan restores (VMark will enumerate static bus registrations + derived
context rather than walk a focus tree; same *property*, different mechanism). Adopt the
extracted-executor plan.

**Refinement 1 — one action *operation*, six palette specs; not six actions.** Zed models
`setHeading(level)`-style actions as **one typed action carrying data**
(`SelectNext { replace_newest: bool }`, `editor/src/actions.rs:9-15`), built from serialized
params. Terminology (sharpened by Codex): the `ActionId` is the *string* `"setHeading"`;
the level is an **invocation parameter**, not part of the id — so "the `ActionId` is
parameterized" is imprecise. VMark's `setHeading` already takes a level (`types.ts:147`);
the executor entry point stays `runEditorAction("setHeading", { level })`. The plan's WI-3.1
expansion to `editor.setHeading.1…6` is legitimate **for the palette** (six searchable
rows) — six `CommandSpec`s that all call the one executor operation, not six actions. The
adoption gate (WI-5.1) must be **structural** — every `ActionId` has ≥1 projected spec,
`setHeading` projects to exactly levels 1–6, every spec invokes
`runEditorAction("setHeading", { level:N })`, no plain `editor.setHeading` registers — not
"reaches the executor" (too dynamic for a gate; WI-5.2's runtime differential covers
execution) and not "six independent actions." The plan's mechanics already point this way.

**Refinement 2 — a filter seam is NOT warranted at VMark's scale (rejected on Codex
review).** Zed has a global `CommandPaletteFilter` in a **standalone crate**
(`command_palette_hooks.rs:19-93`) that subsystems push into by context (vim, agent UI).
My first pass proposed borrowing it as a Phase-2 `WI-2.4`. Codex correctly rejected this:
Zed needs a *separate crate* only because independently-compiled crates (vim, agent) cannot
depend cyclically on the palette — a **cross-crate cycle that does not exist in a single
React app**. Worse, the examples I gave ("hide table actions unless in a table", "hide
mutating actions under read-only") are **already** first-class axes of the WI-2.2
availability descriptor and WI-2b's `mutatesDocument` — so a filter would create *two
authorities* for the same visibility decision, which the per-axis matrix could not
adjudicate. **WI-2.4 is cut.** Availability stays in the single `when(ctx)` descriptor. A
filter seam reopens only if a genuinely independently-owned subsystem ever needs bulk
suppression the action descriptor cannot express — table context and read-only do not meet
that bar.

**Refinement 3 — a closed structured descriptor over `ctx`, evaluated by one typed
function — NOT a predicate DSL (narrowed on Codex review).** Zed expresses availability as
a small predicate *language* over a named context stack (`Editor && mode == full && !menu`,
`keymap/context.rs:171-324`). Its parser earns its keep only because Zed **serializes**
conditions into keymap/extension files; VMark's actions are first-party compiled TS, so a
data DSL (parser, operator semantics, AST, its own validation) would be a second
mini-language with **no current consumer** and a drift risk against the TS types.
`Editor::key_context_internal` (`editor.rs:2641-2764`) is still a good spec for what VMark's
`ctx` should carry (mode, menu-open, selection boundaries, node/file type, editability).
So WI-2.2's descriptor should be a **closed structured record** over the typed `ctx`,
evaluated by one typed function (`when: ctx => actionAvailability(id, ctx)`) — a compiled
closure that *reads* the record, which is what makes the Phase-2 per-axis matrix cheap.
"Not a free-form closure" means "not bespoke per-action logic," not "no closure." Build a
serialized predicate only if external keymaps or third-party declarative commands ever
need it. Zed splits "is a handler present?" from "does the predicate match?"; for VMark's
single editor surface these collapse acceptably into one `when(ctx)` — keep it **pure and
cheap** (it runs on every palette keystroke).

## Out of scope

- MCP-bridge command exposure — a later consumer. **Until it and shortcuts route
  through the bus, this ADR claims "single palette surface", not "single command
  surface".**
- The `Contribution.commands` type itself (ADR-015 WI-4.1) — this ADR unblocks it;
  it lands there.

*(The 6 legacy `use*MenuEvents` hooks are already deleted — `useCommandBootstrap`
records this — so retiring them is not a task here; an earlier draft wrongly
listed it.)*
