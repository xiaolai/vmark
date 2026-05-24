# ADR-008: Workspace as single facade

> Status: **Proposed** | Date: 2026-05-24

## Context

Workspace concerns spread across 7+ stores (`workspaceStore`,
`recentFilesStore`, `recentWorkspacesStore`, `tabStore`, `fileLoadStore`,
`largeFileSessionStore`, `dropZoneStore`) plus 5+ hooks
(`useWorkspaceBootstrap`, `useExternalFileChanges`, `useWindowFileWatcher`,
`useFinderFileOpen`, `useDragDropOpen`). UI components import directly from
any of these. There is no single answer to "what files am I working with"
and no stable surface to depend on.

The existing plan's T09 collapses these stores into one mega-store. That
addresses the surface count but not the contract — the new mega-store
becomes the dependency, and UI components still couple to its shape.

## Considered Options

1. **Merge stores** — one mega-store; UI components import from it directly.
2. **Thin facade hook** — `useWorkspace()` reads multiple stores; mutations
   still go through individual stores.
3. **Facade backed by a service tier** — `useWorkspace()` is the only read
   API; mutations go through commands (ADR-012); stores are private
   implementation detail.

## Decision

Chosen: **Option 3 — `useWorkspace()` as the single read API**; mutations
flow through the command bus.

```ts
const ws = useWorkspace();
ws.currentWorkspace;
ws.openFiles;
ws.activeFile;
ws.recentFiles;

// mutations are commands, not store calls:
commandBus.execute("workspace.openFile", { path });
commandBus.execute("workspace.switchTab", { id });
```

Underlying stores remain (or get merged behind the scenes per T09) but are
not imported outside `src/workspace/`. Reshape the implementation freely
once the facade is the only public surface.

## Verification gate

- `grep -rn "useTabStore\|useFileLoadStore\|useRecentFilesStore\|useRecentWorkspacesStore\|useDropZoneStore\|useLargeFileSessionStore" src/components src/pages`
  returns zero.
- `useWorkspace` is the only exported workspace hook from `src/workspace/`.
- Workspace mutations in UI code (`src/components`, `src/pages`) go through
  `commandBus.execute("workspace.*")`.

## Consequences

- **Good**: UI depends on one stable API. Store reshaping (T09's actual
  target) happens without breaking UI. Workspace state becomes testable in
  isolation. The reskin builds against the facade, not the implementation.
- **Bad**: indirection cost; some hot-path subscriptions go through one
  extra layer of selectors. Requires migrating ~20 components that currently
  import from individual workspace stores.

## Negative space

Workspace does NOT own document content (ADR-009). Does NOT own layout
(ADR-007). Does NOT replace the underlying stores wholesale — it hides them
behind a contract so they can be replaced without coordination.

## Dependencies

- Mutations depend on ADR-012 (command bus).
- Service-tier helpers live in `services/workspace/` per ADR-013.
