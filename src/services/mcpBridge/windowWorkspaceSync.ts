/**
 * Window→workspace registration for MCP routing (WI-3.5 F5).
 *
 * Purpose: tell the Rust bridge which workspace THIS window has open, so
 * workspace-scoped MCP requests (`workspace_root`, `filePath`) route to
 * the owning window instead of only the focused one (session-3 finding
 * F5). Registers the current root on start and on every change; clears
 * it when the workspace closes or the window unmounts. Registrations are
 * deduped by last-sent root, roll back only the latest attempt on failure,
 * and are teardown-safe: a registration that lands after unmount is undone
 * so a closed window never keeps owning a workspace.
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
  // Monotonic per-attempt token so an OLDER failure can't roll back a NEWER
  // registration (audit #7: register A, →B, →A again, then A's first invoke
  // fails — `last === root` would wrongly clear the still-valid third A).
  let attempt = 0;
  // Set once on teardown: no new registration fires, no post-teardown
  // rollback resurrects a retry, and a registration that lands late gets
  // undone (audit #8).
  let disposed = false;

  const register = (root: string | null) => {
    if (disposed || root === last) return; // torn down, or unchanged root
    // Advance optimistically so rapid duplicate changes dedupe without
    // waiting on the round-trip (audit D7).
    last = root;
    const mine = ++attempt;
    void deps
      .invoke("mcp_bridge_set_window_workspace", {
        windowLabel: deps.windowLabel,
        workspaceRoot: root,
      })
      // A single settle handler (not `.then().catch()`) keeps rollback one
      // microtask away, so a retry after a failed registration is prompt.
      .then(
        () => {
          // Torn down while this was in flight: its success re-registered a
          // now-closed window on the bridge — undo it (audit #8).
          if (disposed) void clear();
        },
        (error) => {
          // Roll back only if this is still the latest attempt and we're
          // live, so a failed registration never durably suppresses the
          // retry on the next change (audit D7) without clobbering a newer
          // attempt (audit #7).
          if (!disposed && mine === attempt) last = undefined;
          coherenceLog("window-workspace registration failed:", error);
        },
      );
  };

  const clear = () =>
    deps
      .invoke("mcp_bridge_set_window_workspace", {
        windowLabel: deps.windowLabel,
        workspaceRoot: null,
      })
      .catch(() => {});

  register(deps.getRoot());
  const unsubscribe = deps.subscribe((state) => register(state.rootPath));

  return () => {
    disposed = true;
    unsubscribe();
    // Clear on teardown so a closed window never keeps owning a workspace.
    void clear();
  };
}
