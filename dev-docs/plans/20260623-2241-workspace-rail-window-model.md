# Workspace Rail and Window Model Plan

> Created: 2026-06-23 22:41 CST
> Rebuilt: 2026-06-23 22:53 CST
> Status: Core flag-gated implementation complete; headed E2E and rollout
> follow-ups pending
> Branch: `analysis/single-window-model`
> Scope: Left workspace rail, workspace tear-out, duplicate same-root
> workspace windows, persistence, and Tauri MCP E2E smoke coverage.

## Outcomes

- Document windows show a narrow left rail containing the workspace instances
  owned by that window.
- Opening a workspace defaults to adding or activating an instance in the
  current document window.
- Users can drag a workspace item out of the rail to move that instance into a
  separate document window.
- Users can duplicate a workspace into a separate document window, where the
  new instance has the same root but independent UI state and clean buffers.
- Same-root duplicates are safe: dirty state is not silently forked, same-file
  edits are guarded, and crash restore can represent every instance.
- Every implementation phase has test-first unit/integration coverage plus a
  Tauri MCP smoke route for the running app.

## Hard Constraints

- macOS remains primary. Windows and Linux are best effort and must not regress
  macOS behavior.
- Tauri document windows remain transport containers labeled `main` or `doc-*`.
  Workspace state must not use window labels as durable identity.
- Settings and PDF export windows are non-document windows and never render the
  rail.
- User-facing strings must use `t()` or `t!()` with locale keys.
- No Chrome DevTools MCP. VMark is a Tauri app.
- No dev server for interactive validation. For E2E, the user starts the app
  with `pnpm tauri:dev`, then agents connect through the Tauri MCP bridge.
- The automation bridge port is `127.0.0.1:9323`. Port `9223` is VMark's own
  auth-protected MCP bridge and must not be used for automation.
- Code files should not grow beyond the file-size baseline. New behavior goes
  into focused domain modules instead of expanding large files such as
  `tabStore.ts`, `uiStore.ts`, or `WindowContext.tsx`.

## Research And Installed Tooling

- Tauri MCP server package registered for Codex globally in
  `~/.codex/config.toml` as `[mcp_servers.tauri]` with
  `npx -y @hypothesi/tauri-mcp-server`.
- Codex loads MCP servers at session start. Restart/resume Codex before using
  the newly registered `tauri` tools in this environment.
- The repo already has project MCP config in `.mcp.json` and the package in
  `devDependencies`.
- The app-side bridge is already configured in `src-tauri/src/lib.rs` with
  `tauri_plugin_mcp_bridge::Builder`, `127.0.0.1`, base port `9323`,
  debug-only registration, `mcp-bridge:default`, and `withGlobalTauri: true`.
- Existing non-interactive smoke harness: `pnpm e2e:smoke` talks directly to
  `127.0.0.1:9323` and validates window listing, editor JS execution, editing
  round trip, and native screenshot capture.
- External references: Tauri MCP docs
  `https://hypothesi.github.io/mcp-server-tauri/`, GitHub
  `https://github.com/hypothesi/mcp-server-tauri`, bridge crate docs
  `https://docs.rs/tauri-plugin-mcp-bridge`, VS Code multi-root/floating
  windows, and Zed windows/projects.

## Current Behavior Inventory

- `window_manager.rs` creates document windows with unique labels.
- `lib.rs` handles macOS `RunEvent::Opened`, including cold-start Finder opens,
  directory opens, and grouped file opens, currently mostly through `main`.
- `MainWindowRunners.tsx` owns main-only runners: MCP autostart, update checks,
  hot-exit/crash startup, and Finder file-open handling.
- `WindowContext.tsx` initializes document/window state, handles tab transfer,
  and starts workspace sync.
- `workspaceStore.ts`, `tabStore.ts`, `uiStore.ts`, `useWindowFileWatcher.ts`,
  `workspaceStorage.ts`, and hot-exit all assume window-label scoped workspace
  state, not multiple workspace instances per window.
- Existing E2E talks directly to the bridge socket; this plan keeps it and adds
  MCP-tool smoke flows.

## Target Data Model

### WorkspaceRoot

- `rootId`: stable canonical key; file-backed roots use canonical absolute
  paths, single-file/untitled mode uses `null`.
- `rootPath`, `displayName`, and `platformIdentity` preserve user-facing paths,
  duplicate disambiguation, Windows case/drive rules, and symlink-aware identity
  where filesystem access succeeds.

### WorkspaceInstance

- Durable `workspaceInstanceId`, `rootId`, `rootPath`, `ownerWindowLabel`,
  `createdFrom`, tabs, active tab, closed tabs, per-instance UI slices, and a
  derived `dirtySummary` for close, duplicate, and transfer checks.

### WindowWorkspaceState

- `windowLabel`, ordered `workspaceInstanceIds`, `activeWorkspaceInstanceId`,
  rail layout, and window-only UI such as geometry and app-level overlays.

## Target Rules

- The rail is local to the current document window. It does not list every
  workspace open across the app.
- `main` must always have at least one document context. If moving the last real
  instance out of `main`, create an untitled placeholder in `main`.
- A non-main document window may close after its last instance moves away, but
  only after dirty checks pass.
- Opening a root already present in the same window activates that instance.
- Opening a root present in another window creates a local instance unless the
  command explicitly means "focus existing window".
- Active workspace instance controls file explorer, tabs, active document,
  quick-open results, content search root, default save directory, terminal cwd,
  and file watchers.
- Duplicate workspace creates a new window and a new instance with the same
  root. It copies root/config and UI intent, but only reopens clean file-backed
  tabs from disk.
- Dirty file-backed tabs and untitled dirty tabs are skipped on duplicate and
  reported in a localized notice. They are not silently forked.
- Same-file editing across instances is guarded by canonical file identity.
  Opening read-only is allowed; concurrent dirty writable buffers require a
  warning and explicit user choice.
- Drag-out and cross-window move use a transfer handshake. The source keeps the
  instance until the target claims and acknowledges it.
- If transfer target creation fails, target closes, source closes, or timeout
  occurs, the source instance remains intact.
- Hot-exit v4 stores windows plus workspace instances. Old snapshots migrate
  forward. Corrupt or partial snapshots restore what is valid and report the
  rest non-destructively.
- MCP and command bus target document windows by window label and, when needed,
  workspace instances by `workspaceInstanceId`.

## Edge Cases To Cover

- Empty app/rail/snapshot states; `main` missing during cold-start Finder open.
- Finder directories/files, mixed roots, duplicate roots, non-file URLs,
  permission denial, deleted paths, CJK/spaces/emoji/RTL, symlinks, and Windows
  drive/case variants.
- Rapid repeated opens, duplicate menu events, repeated drag events, drag
  cancel, reorder, drop outside app, drop into another window, target closing,
  and source crash before ack.
- Duplicate with clean, dirty saved, dirty untitled, deleted, binary,
  unsupported, large, or readonly files.
- Same-file opens across same-root duplicates, symlink aliases, external
  changes while dirty, watcher rename/delete events, and in-flight save/search/
  quick-open/watcher/terminal/menu/MCP operations during instance switching.
- Settings from duplicate-root instances, crash during hot-exit write, storage
  quota failure, schema downgrade, partial snapshot restore, and accessibility
  for keyboard navigation, focus, labels, long names, contrast, and small widths.

## Phasing

### Phase 1: Foundations Behind A Disabled Flag

Goal: introduce identity, storage seams, and baseline E2E without changing user
behavior by default.

Implementation status: WI-000 through WI-011 are implemented behind the
disabled `workspaceRailMode` flag. WI-005 has the active workspace scope
resolver plus watcher/search/quick-open/default-save/terminal consumers wired.
WI-006 adds the same-file ownership guard, duplicate read-only opens, guarded
saves, guarded read-only unlocks, canonical alias inputs, and localized dirty
conflict notices. WI-007 has an open-routing bridge that creates or activates
local workspace instances for known target windows. WI-009 has a flag-gated
document-window rail that lists and activates local instances. WI-010 and
WI-011 have flag-gated rail workflows: dragging a workspace item outside the
viewport opens a transfer window with an ack/timeout handshake, and the
duplicate icon opens a second window with the same root while skipping dirty,
untitled, or missing tabs. Deeper command/MCP targeting, reorder, and headed
Tauri MCP smoke remain pending.

### Phase 2: Safe Multi-Instance Mechanics

Goal: make side effects, persistence, file ownership, command targeting, and
open routing instance-aware before exposing duplication or tear-out.

### Phase 3: Rail UX, Transfer, Duplicate, And Rollout

Goal: expose the rail and user workflows only after safety gates pass.

## Work Items

### WI-000: Tauri MCP E2E Baseline And Docs

- Goal: make the E2E route explicit and correct before feature work begins.
- Tests first:
  - Run current `pnpm e2e:smoke` against a live debug app as baseline.
  - After Codex restart, run MCP-tool smoke with `tauri_driver_session`
    `action: "start"`, `port: 9323`, then window list, DOM probe, screenshot,
    and stop.
- Touched areas:
  - `e2e/README.md`
  - `.claude/skills/tauri-mcp-testing/SKILL.md`
  - `dev-docs/baselines/README.md`
- Acceptance:
  - All local docs say 9323 for VMark automation.
  - Docs explicitly say 9223 is not valid for automation.
  - MCP smoke artifacts are stored under `e2e/artifacts/`.
- Dependencies: none.
- Rollback: docs-only revert; MCP global registration can be removed with
  `codex mcp remove tauri` if needed.

### WI-001: Feature Flag And Compatibility Harness

- Goal: add `workspaceRailMode` and keep legacy behavior exact while disabled.
- Tests first:
  - Unit tests prove disabled flag keeps tab keys, workspace storage keys,
    Finder routing, and hot-exit shape unchanged.
  - Unit tests prove flag state can be read by frontend services and Rust
    routing where needed.
- Touched areas:
  - `src/services/featureFlags/`
  - focused Rust config bridge if needed
  - no broad edits to large stores.
- Acceptance:
  - Default is disabled.
  - Existing tests pass without updating expectations for legacy mode.
  - E2E baseline still passes with flag disabled.
- Dependencies: WI-000.
- Rollback: remove flag and leave legacy paths untouched.

### WI-002: Workspace Identity Model

- Goal: create pure model helpers for roots, instances, and window ownership.
- Tests first:
  - `src/utils/workspaceIdentity.test.ts`
  - covers id creation, display names, path normalization, duplicate
    disambiguation, invalid roots, CJK/RTL names, Windows case examples, and
    symlink-canonicalization fallback contracts.
- Touched areas:
  - `src/utils/workspaceIdentity.ts`
  - `src/services/workspaces/canonicalizeWorkspaceRoot.ts`
  - optional Rust command for filesystem canonicalization.
- Acceptance:
  - Pure helpers do not import Zustand or Tauri APIs.
  - Filesystem canonicalization failures return typed results, not thrown
    string errors.
- Dependencies: WI-001.
- Rollback: keep unused helpers behind flag or delete them.

### WI-003: Instance Stores Without File Growth

- Goal: add focused stores/services for instance ownership without expanding
  existing oversized files.
- Tests first:
  - `src/stores/workspaceInstancesStore.test.ts`
  - `src/services/workspaces/windowWorkspaceState.test.ts`
  - activation, reorder, add, remove, placeholder creation, selector behavior,
    and rapid repeated actions.
- Touched areas:
  - new `src/stores/workspaceInstancesStore.ts`
  - new `src/services/workspaces/`
  - small adapters in existing stores only where unavoidable.
- Acceptance:
  - Components use selectors, not Zustand destructuring.
  - Callbacks use `useXStore.getState()` where appropriate.
  - `pnpm lint:file-size` does not require raising baselines.
- Dependencies: WI-002.
- Rollback: disable flag and remove adapters.

### WI-004: Persistence And Hot-Exit V4

- Goal: persist window containers plus workspace instances before multi-window
  mutation is user-visible.
- Tests first:
  - `workspaceStorage.v4.test.ts`
  - `hotExitWorkspaceInstances.test.ts`
  - migration from legacy window-label storage, corrupt snapshot recovery,
    quota/write failure, and downgrade behavior.
- Touched areas:
  - `src/services/persistence/workspaceStorage.ts`
  - `src/services/persistence/hotExit/`
  - Rust session structs if needed.
- Acceptance:
  - Legacy snapshots restore unchanged with flag disabled.
  - Flag-enabled snapshots can restore multiple instances in one window.
  - Partial restore never destroys dirty recoverable data.
- Dependencies: WI-003.
- Rollback: keep v3 reader, stop writing v4 while flag disabled.

### WI-005: Scoped Side Effects

- Goal: make watchers, quick open, content search, default save directory, and
  terminal cwd use active workspace instance scope.
- Tests first:
  - watcher tests for switching, deletion, symlink duplicate, and stale event
    suppression.
  - quick-open/search tests for root isolation and empty/permission-denied
    roots.
  - terminal cwd tests for duplicate roots and untitled placeholder.
- Touched areas:
  - `src/hooks/useWindowFileWatcher.ts`
  - search and quick-open services
  - terminal services
  - instance-scope facade under `src/services/workspaces/`.
- Acceptance:
  - Opening two instances cannot leak watcher/search results across instances.
  - In-flight side effects are cancelled or ignored when instance changes.
- Dependencies: WI-004.
- Rollback: route facade back to window label while flag disabled.

### WI-006: Same-File Ownership Guard

- Goal: prevent silent concurrent writable edits of the same canonical file.
- Status: Implemented behind `workspaceRailMode`.
- Tests first:
  - `src/services/workspaces/fileOwnership.test.ts`
  - same path, symlink path, case variant, external change while dirty,
    clean-readonly duplicate, and forced takeover.
- Touched areas:
  - new `src/services/workspaces/fileOwnership.ts`
  - save/open/read-only command services
  - markdown and split-pane read-only enforcement
  - localized notices.
- Acceptance:
  - Same file can be viewed in multiple instances.
  - A second dirty writable buffer requires explicit user action.
  - Dirty conflict messages identify both source instance and file.
- Dependencies: WI-005.
- Rollback: keep warnings off with flag disabled.

### WI-007: Instance-Aware Open Routing

- Goal: route open workspace/file/Finder/CLI events into the active window and
  instance model.
- Status: Initial implementation. `openWorkspaceWithConfig` now accepts target
  window options and populates/activates local workspace instances behind the
  disabled flag. Existing workspace, recent workspace, Finder, drag/drop,
  transfer, file-open, and first-save adoption paths pass the known
  `windowLabel`.
- Tests first:
  - Rust tests around `RunEvent::Opened` parsing and grouping.
  - frontend tests for cold-start queue, main not ready, multiple roots, and
    explicit new-window commands.
- Touched areas:
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/window_manager.rs`
  - `src/hooks/lifecycle/MainWindowRunners.tsx`
  - `src/hooks/useFinderFileOpen.ts`
  - command services.
- Acceptance:
  - Open workspace adds/activates current-window instance by default.
  - Open in new window still creates a document window.
  - Finder multiple roots become separate instances or windows according to
    explicit action, without losing queued files.
- Dependencies: WI-006.
- Rollback: preserve legacy routing branch behind disabled flag.

### WI-008: MCP And Command Targeting

- Goal: ensure menu, command bus, and MCP operations can target the focused
  window and active workspace instance.
- Tests first:
  - unit tests for focused-window lookup with multiple instances.
  - integration tests for queued menu commands during instance switching.
  - Tauri MCP smoke: list windows, switch instance via DOM/IPC, assert active
    instance id changes in the target window only.
- Touched areas:
  - `src/hooks/mcpBridge/v2/workspace.ts`
  - command bus/menu adapters
  - focused-window helpers.
- Acceptance:
  - Commands do not accidentally apply to the previously active instance.
  - MCP responses include enough instance identity for debugging when flag is
    enabled.
- Dependencies: WI-007.
- Rollback: expose only legacy window target when flag disabled.

### WI-009: Workspace Rail UI

- Goal: render the local rail and support activation/reorder without move-out.
- Status: Initial implementation. `WorkspaceRail` renders only while
  `workspaceRailMode` is enabled, lists instances local to the document window,
  exposes active state, and activates instances on click. Reorder remains
  pending.
- Tests first:
  - React tests for empty rail, active state, reorder, keyboard navigation,
    long names, CJK/RTL names, focus indicators, and i18n.
  - Tauri MCP smoke: screenshot and DOM snapshot prove the rail renders in
    document windows and not in settings/PDF windows.
- Touched areas:
  - new `src/components/WorkspaceRail/`
  - shell slot registration, not broad `App.tsx` edits.
  - locale JSON files.
- Acceptance:
  - Rail is accessible and stable at narrow and normal widths.
  - Settings and PDF export never show the rail.
- Dependencies: WI-008.
- Rollback: hide rail with flag.

### WI-010: Workspace Transfer Protocol

- Goal: move an instance between windows with ack, timeout, and rollback.
- Status: Initial implementation. `workspaceWindowActions` builds a conservative
  workspace payload, `workspace_transfer.rs` stores it in a Rust registry,
  target windows claim `?workspaceTransfer=true`, and the source removes local
  instance/tab state only after `workspace:transfer-ack`. Timeout leaves source
  state intact. Current rail UI moves to a new window when drag ends outside the
  viewport; cross-window drop onto an existing document window remains pending.
- Tests first:
  - transfer registry unit tests for prepare, claim, ack, timeout, source
    close, target close, and duplicate request ids.
  - integration tests for moving last instance out of main/non-main.
  - Tauri MCP smoke: drag or command-trigger transfer, window count changes,
    source/target rails update, and screenshot confirms target state.
- Touched areas:
  - new Rust transfer commands or frontend transfer service.
  - `window_manager.rs`
  - rail drag service.
- Acceptance:
  - Source deletes instance only after target ack.
  - Failed transfer leaves source intact.
  - Main gets placeholder if emptied.
- Dependencies: WI-009.
- Rollback: disable drag-out commands with flag.

### WI-011: Duplicate Workspace

- Goal: duplicate a workspace into a new document window safely.
- Status: Initial implementation. Rail duplicate creates a new workspace
  instance id and uses the same transfer/ack path with operation `duplicate`.
  Only clean file-backed tabs attributed to the workspace are copied; dirty,
  untitled, and missing tabs are skipped and reported through a localized toast.
  Same-file write conflicts are still enforced by WI-006 when files are opened
  or promoted writable.
- Tests first:
  - duplicate service tests for clean tabs, dirty saved tabs, dirty untitled
    tabs, missing files, same-root display names, rapid duplicate, and
    read-only conflict behavior.
  - Tauri MCP smoke: duplicate command creates a second document window with
    same root, different instance id, clean tabs only, and localized skipped
    dirty notice when applicable.
- Touched areas:
  - duplicate command service
  - rail/context menu action
  - file ownership guard integration
  - locale JSON files.
- Acceptance:
  - Dirty buffers are never cloned silently.
  - Same-root duplicate windows can coexist.
  - Same-file writable conflicts are guarded immediately.
- Dependencies: WI-010.
- Rollback: hide duplicate action with flag.

### WI-012: Expanded E2E Smoke And Rollout Gate

- Goal: convert the core workflows into repeatable smoke checks and only then
  make the feature eligible for default-on.
- Tests first:
  - add `e2e/workspace-rail-smoke.mjs` or equivalent direct bridge harness for
    rail render, open, switch, duplicate, transfer, restore, and screenshot.
  - document the MCP-tool version using `tauri_driver_session` on port 9323.
- Touched areas:
  - `e2e/`
  - `package.json` scripts, if adding `e2e:workspace-rail`.
  - release/checklist docs.
- Acceptance:
  - `pnpm check:all` passes.
  - `pnpm e2e:smoke` passes with flag disabled and enabled.
  - Workspace rail smoke passes in a headed debug app.
  - No stale 9223 automation instructions remain in active docs.
- Dependencies: WI-011.
- Rollback: keep feature default-off.

## Testing Procedure

- For each WI, write the named failing tests before implementation.
- Run the narrow test file while implementing.
- Before considering any WI complete, run the relevant subset plus
  `pnpm lint:file-size`.
- Before phase completion, run `pnpm check:all`.
- For E2E:
  1. User starts `pnpm tauri:dev`.
  2. Agent or human runs `pnpm e2e:smoke -- --port 9323`.
  3. After Codex restart, agent may use the installed Tauri MCP tools:
     `tauri_driver_session` start with `port: 9323`, window list, DOM/JS probe,
     screenshot, then stop.
  4. Feature-specific smoke uses screenshots and DOM assertions for rail,
     duplicate, transfer, and restore.
- Do not run Chrome DevTools MCP.
- Do not use 9223 for automation.

## Latest Verification

- `pnpm check:all` passed on 2026-06-24 CST.
- `cargo test hot_exit --manifest-path src-tauri/Cargo.toml` passed: 86 tests.
- `pnpm lint:file-size` passed after the Rust command registration formatting
  adjustment.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` still fails on
  broad pre-existing Rust formatting drift across existing modules. The new
  `src-tauri/src/workspace_transfer.rs` is not listed in that diff; the only
  remaining workspace-transfer reference is inside the already-drifting
  `src-tauri/src/lib.rs` app-run block.
- Codex MCP config lists the `tauri` MCP server as enabled. This running
  session exposes the VMark sidecar MCP tools, not the Tauri
  `tauri_driver_session` surface, so headed MCP smoke remains a follow-up after
  a session/tool reload and a user-started `pnpm tauri:dev`.

## Rollout

- Stage 0: flag exists, default-off, all legacy behavior unchanged.
- Stage 1: internal/dev flag enables model, persistence, scoping, and rail
  render without duplicate or tear-out.
- Stage 2: enable open-into-rail only after scoped side effects and hot-exit v4
  pass.
- Stage 3: enable drag-out only after transfer ack/rollback passes.
- Stage 4: enable duplicate only after same-file ownership and dirty-skip tests
  pass.
- Stage 5: run full manual smoke on macOS headed app. Windows/Linux best-effort
  smoke follows after macOS is green.
- Stage 6: consider default-on only after no data-loss reports and all E2E
  smoke checks are documented.

## Evidence To Collect

- Per WI: failing test commit/output before green implementation.
- Phase 1: disabled-flag compatibility test output and `pnpm e2e:smoke`.
- Phase 2: hot-exit migration output, side-effect isolation tests, conflict
  guard tests, and MCP target smoke notes.
- Phase 3: screenshots for rail, transfer, duplicate, and restore; smoke logs;
  `pnpm check:all` output.

## Open Questions

- Should same-root duplicates default to read-only for already-dirty files, or
  prompt before opening? Default: prompt before writable open, allow read-only.
- Should dropping a workspace item onto another document window move it or copy
  it? Default: move. Copy is explicit duplicate.
- Should the rail ever become global across all windows? Default: no. Local rail
  is the requested model; global overview is future work.

## Definition Of Done

- Feature flag default-off until all WIs pass.
- No raised file-size baselines.
- No new user-facing hardcoded strings.
- Legacy mode remains behaviorally identical.
- Tauri MCP and direct bridge E2E routes both use port 9323.
- Duplicate and tear-out are not exposed before conflict, transfer, and
  hot-exit recovery are complete.
