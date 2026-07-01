/**
 * Workspace Session Persistence
 *
 * Purpose: Persists the current window's session before close — open tab paths
 *   into the workspace config file, and the two-pane split layout (#1081) into
 *   localStorage — so both are restored on reopen.
 *
 * @coordinates-with workspaceStore.ts — reads rootPath and config
 * @coordinates-with useWindowClose.ts — calls persistWorkspaceSession before close
 * @coordinates-with services/persistence/splitLayoutPersistence.ts — saves split layout
 * @module hooks/workspaceSession
 */
import { invoke } from "@tauri-apps/api/core";
import { workspaceError } from "@/utils/debug";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { saveSplitLayout, type SplitLayoutConfig } from "@/services/persistence/splitLayoutPersistence";

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

  // Persist the two-pane split layout (#1081) to localStorage by root path —
  // per-machine UI state, not part of the shared workspace config.
  let splitLayout: SplitLayoutConfig | null = null;
  const split = usePaneStore.getState().byWindow[windowLabel];
  if (split?.enabled && split.primaryTabId && split.secondaryTabId) {
    const priPath = tabs.find((t) => t.id === split.primaryTabId)?.filePath ?? null;
    const secPath = tabs.find((t) => t.id === split.secondaryTabId)?.filePath ?? null;
    // Both panes need a saved path — an untitled pane can't be restored.
    if (priPath && secPath && priPath !== secPath) {
      splitLayout = {
        orientation: split.orientation,
        fraction: split.fraction,
        syncScroll: split.syncScroll,
        primaryPath: priPath,
        secondaryPath: secPath,
      };
    }
  }
  saveSplitLayout(rootPath, splitLayout);

  const updatedConfig = { ...config, lastOpenTabs: openPaths };

  try {
    await invoke("write_workspace_config", {
      rootPath,
      config: updatedConfig,
    });
  } catch (error) {
    workspaceError("Failed to save workspace config:", error);
  }
}
