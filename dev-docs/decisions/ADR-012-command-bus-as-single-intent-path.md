# ADR-012: Command bus as the single intent path

> Status: **Proposed** | Date: 2026-05-24

## Context

Intent flows through multiple unrelated paths today.

- Native menu: `src-tauri/src/menu/localized.rs` emits `menu:{id}`; six
  separate `use*MenuEvents` hooks listen
  (`useMenuEvents`, `useViewMenuEvents`, `useRecentFilesMenuEvents`,
  `useExportMenuEvents`, `useWorkspaceMenuEvents`,
  `useRecentWorkspacesMenuEvents`). A seventh, `useUnifiedMenuCommands`,
  dispatches via `actionRegistry` but does not yet replace the others.
- Shortcuts: `shortcutsStore` + per-feature shortcut hooks
  (`useViewShortcuts`, `useTabShortcuts`, `useFileExplorerShortcuts`,
  `useUniversalToolbar`, `useGenieShortcuts`, etc.).
- UI buttons: in-component handlers that duplicate the action.
- MCP bridge: `src/hooks/mcpBridge/v2/` has 30+ handler files, each a
  parallel intent path.

The `actionRegistry` at `src/plugins/actions/actionRegistry.ts` exists but
is only consulted by `useUnifiedMenuCommands`. `QuickOpen` is file-only;
there is no command palette substrate.

## Considered Options

1. **Status quo** — every intent source routes itself.
2. **Promote `useUnifiedMenuCommands` to dispatch shortcuts too** — half
   step; still no palette substrate.
3. **`CommandBus` as the single intent path** — menus, shortcuts,
   buttons, palette, MCP, programmatic all dispatch through one bus.

## Decision

Chosen: **Option 3 — one `CommandBus`** owns registration, availability
checks, ranking (for palette), and execution.

```ts
commandBus.register({
  id: CommandId;
  title: string;
  scope: "global" | "editor" | "panel";
  when?: (ctx: AppContext) => boolean;        // availability gate
  run: (args, ctx: AppContext) => Promise<void>;
});

commandBus.execute(id, args?);
commandBus.search(query): RankedCommand[];    // for palette
```

Native menu dispatcher, shortcut router, MCP bridge, command palette —
all become consumers of the bus, not parallel routers.

## Verification gate

- `grep -rn "listen.*['\"]menu:" src/` returns exactly 1 match (the
  unified dispatcher).
- `grep -rn "useEffect.*keydown\|addEventListener.*keydown" src/` is
  constrained to a single shortcut router.
- The six `use*MenuEvents` hooks are deleted (subsumes existing T06).
- Command palette implementation queries `commandBus.search(query)`; zero
  hard-coded command lists in palette code.
- Each command appears exactly once in the codebase (registration site is
  the only definition).

## Consequences

- **Good**: command palette becomes a view, not a feature. Adding a
  command = one registration site, no edits across menu/shortcuts/handler
  files. Availability and permissioning live in one place. MCP and UI
  share the same command surface — MCP tools become palette-accessible
  for power users.
- **Bad**: requires migrating the 6 `use*MenuEvents` hooks, the per-
  feature shortcut hooks, and the 30+ MCP bridge handlers. Existing
  `actionRegistry` needs promotion to a full bus (registration +
  execution paths, availability gating). Estimated 1 week focused.

## Negative space

`CommandBus` does NOT handle UI state (open dialogs, popup visibility) —
only intent. Does NOT replace event emitters for non-intent events
(file-changed notifications, IPC progress updates). Does NOT replace
keyboard shortcut data (`shortcutsStore`) — shortcuts become bindings
that resolve to command IDs.

## Dependencies

- Consumed by ADR-008 (workspace mutations), ADR-009 (document
  mutations), and ADR-011 (plugin command declarations).
- Enabled by ADR-013 (command bus lives in `services/commands/`).
- Subsumes existing T06.
