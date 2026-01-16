/**
 * Workspace session persistence
 *
 * Saves last open tabs to workspace config for restore.
 */
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";

/**
 * Persist the current window's open tabs into workspace config.
 */
export async function persistWorkspaceSession(windowLabel: string): Promise<void> {
  const { rootPath, config, isWorkspaceMode } = useWorkspaceStore.getState();

  if (!isWorkspaceMode || !rootPath || !config) {
    return;
  }

  const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const openPaths = tabs
    .filter((t) => t.filePath !== null)
    .map((t) => t.filePath as string);

  const updatedConfig = { ...config, lastOpenTabs: openPaths };

  try {
    await invoke("write_workspace_config", {
      rootPath,
      config: updatedConfig,
    });
  } catch (error) {
    console.error("Failed to save workspace config:", error);
  }
}
