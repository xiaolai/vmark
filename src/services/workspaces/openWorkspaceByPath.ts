/**
 * openWorkspaceByPath — the single "open a folder as the workspace" operation.
 *
 * Both the "Open Folder" menu command (after its dialog) and the open_workspace
 * MCP handler call this, so opening a folder is ONE code path and can't
 * half-open (store set but tabs/rail/split not restored — plan ADR-1).
 *
 * REQUIRES the caller to hold the per-window transition guard
 * (WORKSPACE_TRANSITION_GUARD) around this call (Codex F-08): the menu command
 * guards the dialog + this call together; the MCP handler guards this call.
 * Running two transitions unguarded interleaves restore tabs/split into
 * whichever workspace lands last. Opening a workspace is safe with unsaved
 * changes — it does not close existing tabs, so dirty docs survive (#1005);
 * restoreWorkspaceTabs skips files already open in the window.
 *
 * @coordinates-with services/commands/workspaceCommands.ts — menu "Open Folder"
 * @coordinates-with services/commands/recentWorkspacesCommands.ts — "Open Recent"
 * @coordinates-with services/mcpBridge/v2/workspace.ts — open_workspace handler
 * @module services/workspaces/openWorkspaceByPath
 */
import { invoke } from "@tauri-apps/api/core";
import { useUIStore } from "@/stores/uiStore";
import { useRecentWorkspacesStore } from "@/stores/workspaceStore";
import { openWorkspaceWithConfig } from "@/services/workspaces/openWorkspaceWithConfig";
import { restoreWorkspaceTabs, restoreSplitLayout } from "@/services/navigation/restoreWorkspaceTabs";
import { documentPathsForRestore } from "@/services/persistence/sessionTabs";
import { workspaceError } from "@/utils/debug";

/**
 * The re-entry guard key shared by EVERY command that transitions the window's
 * workspace (open folder, open recent, close). One key per window: two
 * transitions that interleave restore tabs/split into whichever workspace lands
 * last, and a close racing an open persists a half-torn-down workspace.
 */
export const WORKSPACE_TRANSITION_GUARD = "workspace-transition";

/**
 * Run the full open-workspace sequence (config → sidebar → recents → tab
 * restore → split restore) for `path` in the given window (default "main").
 * Never throws — failures are logged, so a caller is not broken by a bad path.
 * Returns whether the sequence completed: menu callers ignore it (best-effort),
 * but the MCP handler MUST fail closed on `false` rather than report a success
 * that did not happen. The caller MUST hold WORKSPACE_TRANSITION_GUARD (see
 * module header).
 */
export async function openWorkspaceByPath(
  path: string,
  options: { windowLabel?: string } = {},
): Promise<boolean> {
  const windowLabel = options.windowLabel ?? "main";
  try {
    // #1252 — extend the fs scope to the workspace tree BEFORE anything reads
    // from it. Scope grants are in-memory and do not survive a restart, so a
    // workspace restored from the previous session — or reopened from recents,
    // or opened over MCP — never passes through the folder picker that would
    // otherwise have granted it. Off the home drive nothing in the static
    // scope (`$HOME/**`, `/Volumes/**`, `/mnt/**`, `/media/**`) covers it, and
    // on Windows `$HOME` is `C:\Users\<name>`, so a workspace on `G:\` is
    // refused entirely.
    //
    // Best-effort: the static scope still covers the common case, so a failed
    // grant must degrade rather than abort an otherwise working open.
    await invoke("allow_workspace_access", { path }).catch((error) => {
      workspaceError("Failed to grant workspace fs scope:", error);
    });
    const existing = await openWorkspaceWithConfig(path, { windowLabel });
    useUIStore.getState().showSidebarWithView("files");
    useRecentWorkspacesStore.getState().addWorkspace(path);
    await restoreWorkspaceTabs(
      windowLabel,
      existing ? documentPathsForRestore(existing) : undefined,
    );
    restoreSplitLayout(windowLabel, path);
    return true;
  } catch (error) {
    workspaceError("Failed to open workspace:", error);
    return false;
  }
}
