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
Execution is a *separate* function, `dispatchEditorAction(action, surface)`
(`plugins/toolbarActions/dispatch.ts`), which the menu dispatcher reaches through
`mapActionIdToAdapterAction` behind the IME guard.

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
> focus/format/read-only/forced-source gates, and an IME-safe captured context
> with tab-bound retry. `dispatchEditorAction` is the **lower-level toolbar**
> path.

So "the adapter reuses the existing menu path via `dispatchEditorAction`" was
false. Routing the palette through `dispatchEditorAction` would break undo/redo
(native per-editor instead of unified), break `paragraph` (no adapter handles
it), and let a palette action mutate a hidden editor on a browser tab. The recon
claim that there was "no async hazard" was also wrong.

## Decision (revised)

**CommandBus is the single command surface for the palette. The editing actions
reach it through a shared high-level executor extracted from the menu — not
through `dispatchEditorAction`.**

The real prerequisite is to **extract the menu's high-level execution logic** out
of the React hook `useUnifiedMenuCommands` into a plain, non-React module that
owns:

- effective-surface resolution (WYSIWYG / Source / **split** / forced-source for
  large-file tabs — not just `sourceMode`),
- document/format/read-only/non-document-tab gates,
- unified cross-mode undo/redo, and the `setHeading`/`paragraph` special cases,
- an IME-safe captured context with the tab-bound retry the menu already does.

Then **both** the native menu and a CommandBus adapter call that shared executor.
`dispatchEditorAction` remains the lower-level toolbar/context-menu path,
unchanged.

For each action, register command(s) via an explicit `ActionId → CommandSpec[]`
mapping (so `setHeading` expands to six from day one), each with:

- `id` = `editor.<actionId>` (namespaced; **collisions are preflighted and
  tested, not assumed impossible** — the bus throws on duplicate id)
- `title` = a real i18n **getter** (`() => t("commands.editor.<id>")`) — new
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

## Out of scope

- MCP-bridge command exposure — a later consumer. **Until it and shortcuts route
  through the bus, this ADR claims "single palette surface", not "single command
  surface".**
- The `Contribution.commands` type itself (ADR-015 WI-4.1) — this ADR unblocks it;
  it lands there.

*(The 6 legacy `use*MenuEvents` hooks are already deleted — `useCommandBootstrap`
records this — so retiring them is not a task here; an earlier draft wrongly
listed it.)*
