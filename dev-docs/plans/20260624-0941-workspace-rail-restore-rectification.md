# Workspace Rail Restore And Loose Files Rectification Plan

Status: draft
Branch: `analysis/single-window-model`
Supersedes: not a replacement for `20260623-2241-workspace-rail-window-model.md`; this is the rectification phase that must land before rail mode graduates from experimental.

## Outcomes

- Opening a workspace while workspace rail mode is enabled attaches it to the current workbench by default. New OS windows are explicit: "open in new window", duplicate, or drag-out.
- Files that do not belong to any open workspace are represented by a first-class rail context named `Loose Files`, not by an ambiguous placeholder.
- Every tab belongs to exactly one rail context in rail mode: a workspace context or the per-window `Loose Files` context.
- Hot-exit restore preserves workspaces, independent files, untitled tabs, rail order, active rail context, active tab, dirty state, read-only state, pinned state, and duplicate-window state.
- Legacy sessions that predate rail ownership are synthesized into the new model without dropping tabs.
- Dragging rail icons supports reorder inside the rail and drag-out to a new window with ack-before-delete safety.
- Tauri MCP smoke tests cover restore and tear-out flows through `tauri_driver_session` on port `9323`.

## Research Notes

- VS Code treats a workspace as one or more folders in a window, while single-folder and untitled multi-root workspaces automatically restore UI state, open files, and layout. Source: https://code.visualstudio.com/docs/editing/workspaces/workspaces
- VS Code makes new-window/reuse-window an explicit command-line choice (`--new-window`, `--reuse-window`) instead of making every folder open imply a new OS window. Source: https://code.visualstudio.com/docs/configure/command-line
- JetBrains IDEs let projects open in a new window, reuse the current window, or attach to an existing window; macOS project windows can be merged into tabs and dragged out again. Source: https://www.jetbrains.com/help/pycharm/open-projects.html
- Zed defaults new projects into the current window's project/thread surface and uses explicit new-window commands for isolation. Source: https://zed.dev/docs/

The common pattern is: default to preserving the user's current workbench, offer explicit OS-window escape hatches, and restore state at the same conceptual level the user sees.

## Current Behavior

- `WorkspaceInstanceIdentity` has `rootId: string | null` and `rootPath: string | null`, but no `kind`. A null-root placeholder and a user's independent files look identical.
- `useWorkspaceRailSeed` creates a placeholder rail entry when rail mode is enabled without a workspace. This makes the rail visible, but it does not own independent files.
- `captureWindowWorkspaceInstances` serializes the instance store as-is. It does not derive ownership from the tab store, so tabs not already in `instance.tabIds` have no reliable rail owner.
- `restoreWindowWorkspaceInstances` returns when a window has no serialized instances. Legacy v3 to v4 migration adds empty containers, so legacy sessions restore tabs but not an equivalent rail model.
- `restoreTabs` creates fresh tab IDs and keeps a local old-to-new `tabIdMap`. Workspace instance `tabIds` are restored before this mapping is known, so persisted membership can become stale.
- `workspaceWindowActions.tabBelongsToWorkspace` deliberately does not attribute file-backed tabs to a rootless instance. That prevents placeholders from stealing workspace tabs, but it also prevents a real `Loose Files` context from carrying independent files.
- `resolveOpenAction`, Finder-open, and drag-drop paths still encode the older rule that outside-workspace files tend to become a new window unless a clean untitled tab can be replaced.
- The feature flag is off by default, which is good: rectification can land behind the flag before user-facing rollout.

## Target Rules

1. A document window is a workbench. The rail lists contexts inside that workbench.
2. Rail contexts have explicit kinds:
   - `workspace`: has `rootId` and `rootPath`.
   - `loose`: per-window group for independent file-backed tabs and untitled tabs.
   - `placeholder`: empty bootstrapping state only; it disappears as soon as a real context exists.
3. There is at most one `loose` context per window. It is created lazily when the first independent or untitled tab needs ownership.
4. A tab in rail mode has exactly one owner context. Ownership is derived by this classifier:
   - If `filePath` is null, owner is `loose`.
   - If `filePath` is inside an open workspace context in the same window, owner is the most specific matching workspace root.
   - If multiple matching workspace contexts have the same root, use the active matching context first, then first rail order.
   - If no workspace context matches, owner is `loose`.
5. Opening a workspace in rail mode:
   - From menu/dialog in a document window: attach or activate in that window.
   - From Finder/CLI/open-url while a document window is focused: attach to that focused/last-focused window.
   - With explicit "new window", duplicate, or drag-out: create a separate OS window.
   - While rail mode is disabled: keep current legacy behavior.
6. Opening independent files in rail mode:
   - Attach to the current/focused workbench under `Loose Files`.
   - Activate an existing tab in the same window when the same path is already open there.
   - If the same file is open in another context/window and dirty+writable, open duplicate as read-only or block write promotion through the existing ownership guard.
7. Dragging rail entries:
   - Drag within the rail reorders contexts and persists order.
   - Drag out of the window moves the context to a new window only after target ack.
   - Duplicate creates a new context/window with clean file-backed tabs only unless a future dialog supports dirty copy semantics.
8. Restore:
   - Restore explicit v5 rail contexts when present.
   - Synthesize missing contexts for old or partial sessions.
   - Reconcile every restored tab into exactly one restored context after tab ID remapping.
   - Never drop tabs because rail metadata is missing, stale, corrupt, or incomplete.

## Data Model And Migration

Move hot-exit schema to v5.

Add fields to `HotExitWorkspaceInstanceState` / Rust `WorkspaceInstanceState`:

```ts
kind: "workspace" | "loose" | "placeholder";
unavailableRoot?: boolean;
```

Keep `rootId` and `rootPath` nullable for compatibility:

- `workspace`: `rootId` and `rootPath` must be non-null after validation.
- `loose`: `rootId` and `rootPath` must be null, `displayName` comes from i18n key `workspaceRail.looseFiles`.
- `placeholder`: null root, no tab ownership, not persisted if any real context exists.

Migration rules:

- v4 to v5:
  - Preserve valid serialized instances and infer `kind = "workspace"` when `rootPath` is present.
  - Infer `kind = "placeholder"` for rootless `createdFrom: "placeholder"` with no tab IDs.
  - Infer `kind = "loose"` for rootless entries that own tabs or were restored from a non-placeholder transfer.
  - If a window has tabs but no valid instances, synthesize:
    - a workspace context from `session.workspace.root_path` when present, then assign matching file tabs.
    - a `Loose Files` context for remaining file tabs and all untitled tabs.
  - If a workspace root no longer exists or cannot be read, keep the workspace context with `unavailableRoot: true`; do not silently convert its tabs to loose.
- Future/partial v5 payloads:
  - Drop instance references to missing tabs.
  - Re-home unowned tabs into `Loose Files`.
  - Deduplicate duplicate tab IDs by first valid owner; later duplicates are removed with a warning.
  - Choose active context by persisted `active_workspace_instance_id`, else context containing restored `active_tab_id`, else first non-placeholder context.

## Work Items

### WI-013: Rail Context Taxonomy

Goal: Make the model distinguish workspace, loose, and placeholder contexts.

Acceptance:

- `WorkspaceInstanceIdentity` carries explicit `kind`.
- Store APIs expose `ensureLooseInstance(windowLabel)` separately from `ensurePlaceholderInstance`.
- Placeholder creation remains only for an empty workbench; placeholder is removed or replaced when a real workspace or loose context appears.
- `Loose Files` label uses i18n keys in all supported locale files, with English fallback copied for non-English locales as this project currently does for rail strings.

Tests first:

- Unit tests for `createWorkspaceInstance` defaulting `kind` correctly.
- Store tests for one-loose-context-per-window idempotence.
- Store tests proving placeholders do not persist once loose/workspace contexts exist.
- Validation tests for corrupt `kind`, empty root workspace, and rootless workspace payloads.

Touched areas:

- `src/utils/workspaceIdentity.ts`
- `src/stores/workspaceInstancesStore.ts`
- `src/services/persistence/hotExit/types.ts`
- `src-tauri/src/hot_exit/session.rs`
- `src/locales/*/common.json`

Dependencies: none.

Risks: changing persisted shape requires synchronized TypeScript and Rust schema work.

Rollback: keep v4 parser accepting old fields and gate v5 write path behind `workspaceRailMode`.

### WI-014: Tab Ownership Classifier

Goal: Centralize tab-to-context ownership so open, save, transfer, capture, and restore agree.

Acceptance:

- New pure service classifies a tab into a workspace context or `Loose Files`.
- Most-specific root wins for nested roots.
- Same-root duplicates use active context first, then rail order.
- Untitled tabs always belong to `Loose Files`.
- Independent root-level files that cannot produce a workspace root still belong to `Loose Files`.

Tests first:

- No workspace, one file-backed tab -> loose.
- One workspace, inside file -> workspace.
- One workspace, outside file -> loose.
- Nested roots `/repo` and `/repo/docs`, file `/repo/docs/a.md` -> `/repo/docs`.
- Duplicate same-root contexts with active second context -> active second.
- CJK, spaces, parentheses, symlink canonical path supplied, Windows case-insensitive path, POSIX case-sensitive path.

Touched areas:

- New `src/services/workspaces/workspaceContextOwnership.ts`
- `src/services/workspaces/fileOwnership.ts`
- `src/services/workspaces/workspaceWindowActions.ts`

Dependencies: WI-013.

Risks: ambiguous ownership can surprise users if two duplicate contexts share a root. Use active-context-first to match visible intent.

Rollback: classifier can be bypassed by feature flag, leaving legacy open policy intact.

### WI-015: Open Routing Rectification

Goal: In rail mode, attach new workspaces and independent files to the current workbench unless a new window is explicit.

Acceptance:

- `handleOpen`, Finder open, drag-drop open, and save-post-workspace-open use rail-aware routing.
- Legacy routing remains unchanged when rail mode is disabled.
- Explicit new-window commands still call `open_workspace_in_new_window` / `open_file_in_new_window`.
- Opening a workspace already in the rail activates its existing context instead of creating duplicates.
- Opening a file outside all contexts creates or activates `Loose Files` and opens the tab there.

Tests first:

- Pure policy tests for rail-enabled attach vs explicit new-window.
- Finder hot-open after restore routes to focused/last-focused document window.
- Drag-drop multiple files with mixed workspace and loose membership groups correctly.
- Rapid repeated opens deduplicate by path in the target window.
- Permission/read failures do not create empty owner contexts unless a tab survives.

Touched areas:

- `src/utils/openPolicy.ts`
- `src/hooks/useFileOpen.ts`
- `src/hooks/useFinderFileOpen.ts`
- `src/hooks/useDragDropOpen.ts`
- `src/hooks/openWorkspaceWithConfig.ts`
- Rust window manager only where explicit-new-window commands need naming clarity.

Dependencies: WI-014.

Risks: Finder/CLI routing uses main-window assumptions today. Track last-focused document window explicitly before changing Rust dispatch.

Rollback: keep new policy behind `workspaceRailMode`; disable flag to recover legacy new-window behavior.

### WI-016: Capture And Restore Reconciliation

Goal: Restore workspaces and independent files as the user saw them, even when persisted metadata is old, partial, or stale.

Acceptance:

- `captureWindowWorkspaceInstances` derives fresh `tabIds`, `activeTabId`, and `closedTabIds` from stores at capture time.
- `restoreTabs` returns or emits old-to-new tab ID mapping.
- Rail restore runs a post-tab reconciliation pass using the tab ID mapping.
- Legacy v3/v4 sessions synthesize workspace and loose contexts.
- Corrupt instance references never drop tabs; unowned restored tabs go to `Loose Files`.
- Empty sessions still get the current WindowContext fallback without a persisted loose context.

Tests first:

- v4 session with workspace root and tabs but empty rail containers synthesizes workspace context.
- v4 session with mixed inside/outside/untitled tabs synthesizes workspace plus loose contexts.
- v5 session with stale `tabIds` is remapped to new tab IDs.
- Duplicate persisted `tabIds` resolve to one owner.
- Missing active context falls back to context containing active tab.
- All-empty-untitled session preserves existing blank fallback and does not persist noisy loose state.
- Rust migration mirrors TypeScript migration fixtures byte-for-byte where practical.

Touched areas:

- `src/services/persistence/hotExit/schemaMigration.ts`
- `src/services/persistence/hotExit/workspaceInstances.ts`
- `src/services/persistence/hotExit/restoreHelpers.ts`
- `src/services/persistence/resilience/_hotExitRestore.ts`
- `src-tauri/src/hot_exit/session.rs`
- `src-tauri/src/hot_exit/migration.rs`
- Rust migration tests.

Dependencies: WI-013, WI-014.

Risks: restore ordering is delicate. Prefer a small post-restore function over threading rail ownership through tab creation.

Rollback: keep v4 reading path and only write v5 when rail mode is enabled.

### WI-017: Loose Files Rail UI

Goal: Make independent files visible and understandable without adding clutter.

Acceptance:

- `Loose Files` appears as a rail icon only when it owns at least one tab or is the active target for a new untitled file.
- Use a distinct icon from `lucide-react` such as `Files` or `FileStack`, not the workspace folder icon.
- Number badge remains for workspace entries; loose entry can show its rail position if consistent with the current UI, but it must not imply a folder.
- Active state remains colored icon only, per latest feedback.
- Tooltip and ARIA labels use i18n.
- Long/CJK/RTL labels do not overflow tooltip/accessible text tests.

Tests first:

- Render tests for workspace + loose + placeholder combinations.
- Active loose context visual class/style.
- Duplicate/move buttons respect unsupported states for placeholder.
- Keyboard activation works for loose context.

Touched areas:

- `src/components/WorkspaceRail/WorkspaceRail.tsx`
- `src/components/WorkspaceRail/WorkspaceRail.css`
- `src/locales/*/common.json`

Dependencies: WI-013.

Risks: icon-only UI can be ambiguous. Tooltip and context menu labels carry semantics.

Rollback: loose context can be hidden while ownership still works, but this should only be an emergency fallback.

### WI-018: Drag Reorder And Drag-Out Semantics

Goal: Support reorder and drag-out without accidental data loss.

Acceptance:

- Dragging inside rail reorders contexts and persists the new order.
- Dragging outside viewport triggers move-to-new-window only after a clear threshold and target ack.
- Drag cancel, ESC, or dropping back inside window leaves source untouched.
- Moving a workspace transfers owned tabs; moving `Loose Files` transfers its loose tabs.
- Duplicating `Loose Files` follows current duplicate safety: clean file-backed tabs only; dirty, missing, and untitled tabs are skipped with localized count feedback.
- If moving the last real context out of main, main receives a placeholder; if moving from a secondary window and no contexts remain, the window closes only after ack.

Tests first:

- Reorder persistence and active context preservation.
- Drag-out ack success removes source context and tabs.
- Timeout/invoke failure/listener failure keeps source intact.
- Loose move includes independent and untitled tabs.
- Loose duplicate skips dirty, missing, and untitled tabs with counts.
- Rapid repeated drag starts cannot double-move the same context.

Touched areas:

- `src/components/WorkspaceRail/WorkspaceRail.tsx`
- `src/services/workspaces/workspaceWindowActions.ts`
- `src-tauri/src/workspace_transfer.rs`
- `src-tauri/src/window_manager.rs`

Dependencies: WI-014, WI-016.

Risks: HTML drag events can report odd coordinates. Keep the existing outside-viewport guard but add explicit drop-zone/reorder state for deterministic tests.

Rollback: keep duplicate button and disable drag-out while preserving reorder.

### WI-019: Scope Consumers

Goal: Ensure every feature that asks "what workspace am I in?" respects active rail context and loose files.

Acceptance:

- File explorer, quick open, content search, terminal cwd sync, default save folder, watchers, MCP workspace commands, and AI-provider workspace assumptions read from active rail scope.
- `Loose Files` reports `isWorkspaceMode: false`, `rootPath: null`, and uses sibling-tab/default-folder behavior for Save As.
- Workspace contexts with `unavailableRoot` do not start file watchers or terminal `cd`, but still display and restore tabs.
- Switching active rail context updates terminal cwd only for real workspace roots.

Tests first:

- Active workspace scope tests for loose, placeholder, unavailable root, and duplicate same-root contexts.
- Default save folder tests for loose with saved sibling files.
- Terminal sync skips loose and unavailable roots.
- File watcher subscribes only to active available workspace root.

Touched areas:

- `src/services/workspaces/activeWorkspaceScope.ts`
- `src/hooks/useActiveWorkspaceScope.ts`
- `src/hooks/useDefaultSaveFolder.ts`
- `src/hooks/useWindowFileWatcher.ts`
- `src/components/Terminal/terminalSessionStoreSync.ts`
- MCP bridge workspace/session helpers as needed.

Dependencies: WI-013, WI-014.

Risks: Some callers may still read `workspaceStore.rootPath` directly. Use `rg` to audit and replace only feature-relevant reads.

Rollback: scope helper remains feature-flagged.

### WI-020: Tauri MCP Smoke Gates

Goal: Prove the rectified mental model in the real Tauri app.

Acceptance:

- Smoke suite uses Tauri MCP only. Connect with `tauri_driver_session` action `start`, port `9323`.
- No Chrome DevTools MCP.
- Smoke cases are documented and runnable from a script or checklist.
- `pnpm check:all` passes.

Tests first:

- Add focused unit/integration tests before implementation in WI-013 through WI-019.
- Add one E2E smoke after the model is stable.

Smoke scenarios:

- Enable workspace rail mode, open workspace A, open workspace B; both appear in one rail in current window.
- Open an outside file; `Loose Files` appears and owns that tab.
- Quit/restart through hot-exit; workspace A, workspace B, `Loose Files`, active context, and active tab restore.
- Drag workspace B out; source remains until target ack, then B appears in a separate window.
- Duplicate workspace A; clean file-backed tabs appear in the new window, dirty tabs are skipped/read-only per policy.
- Reorder rail entries; quit/restart; order persists.
- Delete or rename workspace root on disk before restore; context remains marked unavailable and tabs remain visible.

Touched areas:

- Existing E2E or smoke-test harness under `e2e/` or `scripts/`.
- Plan verification notes.

Dependencies: WI-013 through WI-019.

Risks: MCP server/app timing can be flaky. Use restore completion events and explicit waits instead of sleeps.

Rollback: do not flip the feature flag default until this WI passes.

## Edge Cases Checklist

- Empty app launch with no workspace and no tabs.
- Empty app launch with one clean untitled fallback tab.
- Untitled dirty tab in `Loose Files`.
- Root-level file such as `/note.md` that cannot produce a workspace root.
- File outside any workspace after workspace contexts exist.
- File inside nested workspace roots.
- Same workspace root opened twice in same window.
- Same workspace root opened in multiple windows.
- Same file opened in two contexts, one dirty+writable.
- Same file path with Windows case variants.
- Same file through symlink alias when canonical paths are known.
- Unicode/CJK/RTL workspace display names.
- Long paths and display-name collisions.
- Workspace root deleted, permission denied, or moved between capture and restore.
- Corrupt persisted rail payload.
- Stale persisted active context.
- Stale persisted active tab.
- Stale `tabIds` after hot-exit tab ID remap.
- Duplicate `tabIds` across contexts.
- Rapid repeated open workspace/open file commands.
- Drag cancel, drag outside viewport accidentally, and drag timeout.
- Target window fails to create or fails to ack.
- Secondary window loses its last context.
- Main window loses its last context.
- localStorage unavailable/quota exceeded for rail snapshot.
- Feature flag disabled with v5 session present.

## Manual Test Checklist

- Run `pnpm test -- workspaceIdentity workspaceInstancesStore workspaceContextOwnership`.
- Run `pnpm test -- hotExitWorkspaceInstances schemaMigration.v4 schemaMigration.v5`.
- Run `pnpm test -- openPolicy useFileOpen useFinderFileOpen useDragDropOpen`.
- Run `pnpm test -- workspaceWindowActions WorkspaceRail activeWorkspaceScope useDefaultSaveFolder`.
- Run Rust tests for `hot_exit::migration`, `hot_exit::session`, `workspace_transfer`, and `window_manager`.
- Run `pnpm check:all`.
- With dev VMark running, connect Tauri MCP on `127.0.0.1:9323` and execute WI-020 smoke scenarios.

## Plan To Verify Handoff Evidence

- Commit messages for this phase should reference WI-013 through WI-020.
- When implementation finishes, run `scripts/check-wi-linkage.sh dev-docs/plans/20260624-0941-workspace-rail-restore-rectification.md`.
- Verification should include:
  - test command outputs,
  - Tauri MCP smoke transcript or artifact path,
  - screenshots for rail UI states,
  - known residual risks if any.
