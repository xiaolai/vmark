# Command Registry Unification — Phased Plan

**Status:** Phase 0 — not started
**Branch:** `refactor/vmark-core`
**ADR:** `dev-docs/decisions/ADR-017-command-bus-absorbs-the-action-registry.md`
**Unblocks:** ADR-015 `Contribution.commands` (WI-4.1 remainder)

Goal: the Command Palette finds every editing action, and the action registry
becomes a data source bridged into the CommandBus — one command surface, one
execution path (`dispatchEditorAction`).

## Guiding constraint

The adapter is **wiring, never a second implementation**. Every command it
registers must, when run, reach the *existing* `dispatchEditorAction` behind the
*existing* IME guard. If the plan ever tempts a reimplementation of an editing
action, stop — that is the wrong path.

## Phase 0 — Reconnaissance (no code)

Three unknowns must be resolved before the adapter is written, because each
changes its shape.

| WI | Question | Where |
|---|---|---|
| WI-0.1 | Are `ActionDefinition.label`s i18n **keys** or already-resolved **strings**? The adapter localizes differently for each. | `plugins/actions/actionDefinitions*.ts` |
| WI-0.2 | Enumerate every **parameterized** action (currently `setHeading`), its params, and how the menu expands it. | `plugins/actions/types.ts` `MenuActionMapping`, `useUnifiedMenuCommands` |
| WI-0.3 | Confirm `dispatchEditorAction` is the **sole** executor for all 83 actions (no action bypasses it). | `plugins/toolbarActions/dispatch.ts`, adapters |

**DoD:** a short findings note in this file's Phase 0 section answering all
three, with file:line evidence. No production change.

### Phase 0 findings (2026-07-23)

- **WI-0.1 — labels are raw English strings, not i18n keys.** `ActionDefinition.label`
  is `"Bold"`, `"Undo"`, `"Inline Code"` (`actionDefinitionsCore.ts:18,32,44`),
  and it is barely consumed — the menu renders Rust-side `en.yml` labels, not
  `ActionDefinition.label`. **Consequence: the adapter must introduce NEW
  translation keys** for palette titles (≈83 commands × 9 locales) rather than
  reuse existing translated labels. This is real added scope — route it through
  the `translate-docs` skill. Until keys exist, titles may register as
  `LocalizedString` getters returning the English string, so the palette works
  in English and translations land incrementally.
- **WI-0.2 — `setHeading` is the ONLY parameterized action.** `ActionParams` has
  exactly one key (`setHeading: { level: HeadingLevel }`, `types.ts:147-148`),
  and it is the sole discriminated case in `MenuActionMapping` (`:204`). Phase 2
  expands exactly one action into six commands. Bounded.
- **WI-0.3 — `dispatchEditorAction` is the sole executor, and the current
  surface/mode is synchronously readable.** Menu (`useUnifiedMenuCommands`),
  toolbar (`UniversalToolbar.tsx:158`), and context menu (`runMenuAction.ts:113`)
  all funnel through `dispatchEditorAction(action, surface)`. The menu chooses
  the surface at dispatch time from `useEditorStore.getState().active.activeSourceView`
  and `useUIStore.getState().sourceMode` — both synchronous. So the adapter's
  `run()` reads the same state, builds the same context, and dispatches behind
  the same IME guard, with no async hazard the menu does not already carry.
  **The adapter is viable as specified.**

Net: the plan holds; the one scope addition is WI-0.1's translation keys.

## Phase 1 — The adapter (the core)

Build `services/commands/actionBridge.ts`: iterate the action registry, register
one `CommandDefinition` per action on the CommandBus.

| WI | Change |
|---|---|
| WI-1.1 | For each `ActionDefinition`, register `{ id: "editor.<actionId>", title: t(label), scope: "editor", when: ctx => actionSupportsMode(id, ctx.mode), run: … }` |
| WI-1.2 | `run` builds the current surface (`buildWysiwygContext`/`buildSourceContext` by mode) and calls `dispatchEditorAction(mapActionIdToAdapterAction(id), surface)` behind the IME guard — the exact menu path |
| WI-1.3 | Register **once** — idempotent guard (module-load or a `registered` flag), since the bus throws on duplicate id (mirror `fenceRegistry` WI-5.6) |
| WI-1.4 | Bootstrap the bridge where the app wires the bus (find the CommandBus bootstrap site; add the bridge call there) |

**DoD (machine-checkable):**
- `searchCommands("bold")`, `searchCommands("italic")`, `searchCommands("undo")`
  each return ≥1 runnable command — contract test.
- No duplicate-id throw on a simulated double bootstrap — test.
- `pnpm check:all` green.

## Phase 2 — Parameterized actions

`setHeading` (and any other found in WI-0.2) cannot be a single command — the
palette can't ask for a level.

| WI | Change |
|---|---|
| WI-2.1 | Expand each parameterized action into discrete commands (`editor.setHeading.1` … `editor.setHeading.6`), each with its own title ("Heading 1" …) and bound params |
| WI-2.2 | The plain `setHeading` id is **not** registered as a runnable command (no un-runnable palette row) |

**DoD:**
- `searchCommands("heading 2")` returns a command that, run, sets an H2 —
  differential against the `menu:` heading-2 path.
- No registered command has undefined required params — test asserts every
  `editor.*` command is runnable.

## Phase 3 — Gates (ADR-015 D6: count adoption, not existence)

| WI | Change |
|---|---|
| WI-3.1 | Adoption gate: `set(actionRegistry ids)` ⊆ `set(bus "editor.*" ids)` after bootstrap, asserted in a test (ratchets toward full coverage) |
| WI-3.2 | Differential: executing `editor.bold` yields the same document change as `menu:bold`, through the one shared `dispatchEditorAction` |
| WI-3.3 | Mode-scope: a Source-mode palette does not list or run a WYSIWYG-only action (uses `actionSupportsMode`) |

**DoD:** all three tests present and green; the adoption assertion fails if a new
action is added without reaching the bus.

## Phase 4 — Deferred cleanup (not required to close this plan)

- Retire the 6 legacy `use*MenuEvents` hooks the adapter makes redundant
  (ADR-012's own backlog).
- Expose the now-complete bus to the MCP bridge.

## Then: ADR-015 `Contribution.commands`

With editing actions already bus commands, a format/extension contributes a
`CommandDefinition` the same way. That work lands in the extension plan
(`dev-docs/plans/20260722-extension-architecture.md` WI-4.1), not here.

## Review gate

Per `.claude/rules/60-ai-governance.md` §6, this plan touches command routing
across ≥3 phases — run a Codex cross-model review of this file before Phase 1
commits.
