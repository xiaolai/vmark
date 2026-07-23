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

## Decision

**CommandBus is the single command surface. The action registry becomes a data
source bridged into it by a generated adapter.**

For each `ActionDefinition`, register a `CommandDefinition` whose:

- `id` = `editor.<actionId>` (namespaced so it cannot collide with the 66
  existing bus ids)
- `title` = the action's localized label
- `scope` = `"editor"`
- `when(ctx)` = `actionSupportsMode(actionId, ctx.mode)` — so the palette hides
  an action not valid in the current WYSIWYG/Source mode, exactly as the menu
  greys it out
- `run` = build the current surface context (`buildWysiwygContext` /
  `buildSourceContext` by mode) and call
  `dispatchEditorAction(mapActionIdToAdapterAction(actionId), surface)` **behind
  the same IME guard the menu uses**

Crucially the adapter reuses the *existing* execution path — it does not
reimplement bold. The menu, the palette, a shortcut, and (later) an extension all
reach the same `dispatchEditorAction`.

### Why this direction, not the reverse

Making the action registry the single surface was rejected. The bus already has
what a command surface needs and the action registry does not: `run`, `when`,
localized `title`, scope, `search`, and the palette already consumes it. The
editing actions are the *only* large caller outside the bus; lifting 83 of them
up is far less churn than moving 66 bus commands down into a metadata catalog
that has no execution model.

## Consequences

**Good**
- The palette finds every editing action — the ADR-012 promise, finally true.
- **Unblocks ADR-015 `Contribution.commands`**: with editing actions already
  bus commands, a format/extension contributes a `CommandDefinition` the same
  way, and it appears everywhere the bus is consumed.
- One execution path (`dispatchEditorAction`) stays authoritative; the adapter is
  wiring, not a second implementation.
- The IME guard and mode-awareness are preserved because the adapter routes
  through the same dispatcher.

**Costs / risks**
- **Parameterized actions.** `setHeading` needs a `level`. The menu maps six
  discrete entries (Heading 1–6); the adapter must expand these into six
  commands (`editor.setHeading.1` …) rather than one, or the palette shows an
  un-runnable "Set Heading". Handled in the plan (WI-2).
- **Localization.** `ActionDefinition.label` is a plain string; the adapter must
  route it through `t()` so palette rows are translated. Audit whether labels are
  keys or already-resolved strings first (WI-1).
- **Double-registration on remount.** The bus throws on duplicate id; the adapter
  must register once (module load or an idempotent guard), like the fence
  registry (ADR-015 WI-5.6).
- **Scope/`when` correctness.** An action valid only in WYSIWYG must not run from
  the palette in Source mode. `actionSupportsMode` already encodes this; the
  `when` must use it, and a test must prove a Source-only palette hides
  WYSIWYG-only actions.

## Verification gates

- Searching the palette for "bold", "insert table", "heading 2" returns a
  runnable command (contract test against `searchCommands`).
- `set(actionRegistry ids)` ⊆ `set(bus command ids)` after bootstrap — an
  adoption count asserted in CI, per ADR-015 D6 (count adoption, not existence).
- Executing `editor.bold` from the bus produces the same document change as the
  `menu:bold` path (differential test through one shared `dispatchEditorAction`).
- A palette in Source mode does not list or run a WYSIWYG-only action.

## Out of scope

- Migrating the 6 legacy `use*MenuEvents` hooks (ADR-012's own backlog) — the
  adapter makes them redundant but removing them is separate.
- MCP-bridge command exposure — a later consumer of the now-complete bus.
- The `Contribution.commands` type itself (ADR-015 WI-4.1) — this ADR unblocks it;
  it lands there.
