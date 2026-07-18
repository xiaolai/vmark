/**
 * Window→workspace registration for MCP routing (WI-3.5 F5).
 *
 * Purpose: tell the Rust bridge which workspace THIS window has open, so
 * workspace-scoped MCP requests (`workspace_root`, `filePath`) route to
 * the owning window instead of only the focused one (session-3 finding
 * F5). Registers the current root on start and on every change; clears
 * it when the workspace closes or the window unmounts.
 *
 * @coordinates-with src-tauri/src/mcp_bridge/commands.rs — mcp_bridge_set_window_workspace
 * @coordinates-with src-tauri/src/mcp_bridge/window_routing.rs — the router that reads the map
 * @module services/mcpBridge/windowWorkspaceSync
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { coherenceLog } from "@/utils/debug";

/**
 * Start syncing this window's workspace root to the bridge; returns a
 * disposer that clears the registration. Injectable invoke/label/subscribe
 * for tests.
 */
export function startWindowWorkspaceSync(
  deps: {
    invoke: typeof invoke;
    windowLabel: string;
    subscribe: typeof useWorkspaceStore.subscribe;
    getRoot: () => string | null;
  } = {
    invoke,
    windowLabel: getCurrentWebviewWindow().label,
    subscribe: useWorkspaceStore.subscribe,
    getRoot: () => useWorkspaceStore.getState().rootPath,
  }
): () => void {
  let last: string | null | undefined;

  const register = (root: string | null) => {
    if (root === last) return; // no-op on unchanged root
    last = root;
    void deps
      .invoke("mcp_bridge_set_window_workspace", {
        windowLabel: deps.windowLabel,
        workspaceRoot: root,
      })
      .catch((error) => {
        coherenceLog("window-workspace registration failed:", error);
      });
  };

  register(deps.getRoot());
  const unsubscribe = deps.subscribe((state) => register(state.rootPath));

  return () => {
    unsubscribe();
    // Clear on teardown so a closed window never keeps owning a workspace.
    void deps
      .invoke("mcp_bridge_set_window_workspace", {
        windowLabel: deps.windowLabel,
        workspaceRoot: null,
      })
      .catch(() => {});
  };
}
