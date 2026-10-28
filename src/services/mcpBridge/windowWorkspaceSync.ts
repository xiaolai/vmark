/**
 * Window→workspace registration for MCP routing.
 *
 * Purpose: tell the Rust bridge which workspace THIS window has open (the
 *   bridge records it for the window the call comes from), so
 * workspace-scoped MCP requests (`workspace_root`, `filePath`) route to
 * the owning window instead of only the focused one (session-3 finding
 * F5). Registers the current root on start and on every change; clears
 * it when the workspace closes or the window unmounts. Dedupe, rollback and
 * teardown safety are `bridgeRegistration.ts`'s, so a closed window never
 * keeps owning a workspace.
 *
 * @coordinates-with src-tauri/src/mcp_bridge/commands.rs — mcp_bridge_set_window_workspace
 * @coordinates-with src-tauri/src/mcp_bridge/window_routing.rs — the router that reads the map
 * @coordinates-with bridgeRegistration.ts — the registration lifecycle
 * @module services/mcpBridge/windowWorkspaceSync
 */
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { coherenceLog } from "@/utils/debug";
import { startBridgeRegistration } from "./bridgeRegistration";

/**
 * Start syncing this window's workspace root to the bridge; returns a
 * disposer that clears the registration. Injectable invoke/subscribe/root
 * for tests.
 */
export function startWindowWorkspaceSync(
  deps: {
    invoke: typeof invoke;
    subscribe: typeof useWorkspaceStore.subscribe;
    getRoot: () => string | null;
  } = {
    invoke,
    subscribe: useWorkspaceStore.subscribe,
    getRoot: () => useWorkspaceStore.getState().rootPath,
  }
): () => void {
  return startBridgeRegistration<string | null>({
    invoke: deps.invoke,
    command: "mcp_bridge_set_window_workspace",
    args: (root) => ({ workspaceRoot: root }),
    cleared: null,
    key: (root) => JSON.stringify(root),
    current: deps.getRoot,
    subscribe: (onValue) => deps.subscribe((state) => onValue(state.rootPath)),
    onError: (error) => coherenceLog("window-workspace registration failed:", error),
  });
}
