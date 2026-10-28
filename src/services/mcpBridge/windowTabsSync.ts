/**
 * Window→tabs registration for MCP routing — tell the Rust bridge which tabs
 * THIS window holds, so a request naming a tab routes to the window whose
 * webview holds it (each window's stores hold only its own tabs; any other
 * window would answer INVALID_TAB or act on its own focused tab).
 *
 * Publishes on start and whenever this window's tab list changes, and an
 * empty list on teardown; the lifecycle is `bridgeRegistration.ts`'s.
 *
 * @coordinates-with src-tauri/src/mcp_bridge/commands.rs — mcp_bridge_set_window_tabs
 * @coordinates-with src-tauri/src/mcp_bridge/window_routing.rs — routes by the published tabs
 * @coordinates-with bridgeRegistration.ts — the registration lifecycle
 * @module services/mcpBridge/windowTabsSync
 */
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { mcpBridgeLog } from "@/utils/debug";
import { startBridgeRegistration } from "./bridgeRegistration";

type TabState = ReturnType<typeof useTabStore.getState>;

/** Start publishing this window's tab ids; returns the disposer that clears them. */
export function startWindowTabsSync(send: typeof invoke = invoke): () => void {
  const label = getCurrentWindowLabel();
  const idsOf = (state: TabState): string[] => (state.tabs[label] ?? []).map((tab) => tab.id);
  return startBridgeRegistration<string[]>({
    invoke: send,
    command: "mcp_bridge_set_window_tabs",
    args: (tabIds) => ({ tabIds }),
    cleared: [],
    key: (tabIds) => tabIds.join("\n"),
    current: () => idsOf(useTabStore.getState()),
    subscribe: (onValue) => useTabStore.subscribe((state) => onValue(idsOf(state))),
    onError: (error) => mcpBridgeLog("window-tabs registration failed:", error),
  });
}
