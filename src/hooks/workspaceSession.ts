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
import { tabFilePath } from "@/stores/tabStoreTypes";
import { usePaneStore } from "@/stores/paneStore";
import { saveSplitLayout, type SplitLayoutConfig } from "@/services/persistence/splitLayoutPersistence";
import { serializeSessionTabs, documentPathsOf } from "@/services/persistence/sessionTabs";

/**
 * Persist the current window's open tabs into workspace config.
 */
export async function persistWorkspaceSession(windowLabel: string): Promise<void> {
  const { rootPath, config, isWorkspaceMode } = useWorkspaceStore.getState();

  if (!isWorkspaceMode || !rootPath || !config) {
    return;
  }

  const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
  // Legacy field: document paths only, so a downgraded (older) VMark still
  // restores document tabs and simply skips browser tabs (WI-1.1 / R1).
  const openPaths = documentPathsOf(tabs);

  // Persist the two-pane split layout (#1081) to localStorage by root path —
  // per-machine UI state, not part of the shared workspace config.
  let splitLayout: SplitLayoutConfig | null = null;
  const split = usePaneStore.getState().byWindow[windowLabel];
  if (split?.enabled && split.primaryTabId && split.secondaryTabId) {
    const priTab = tabs.find((t) => t.id === split.primaryTabId);
    const secTab = tabs.find((t) => t.id === split.secondaryTabId);
    const priPath = priTab ? tabFilePath(priTab) : null;
    const secPath = secTab ? tabFilePath(secTab) : null;
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

  // New field: full ordered tab list incl. browser tabs (WI-1.1). New builds
  // prefer this; old builds ignore the unknown field (serde default).
  const updatedConfig = {
    ...config,
    lastOpenTabs: openPaths,
    sessionTabs: serializeSessionTabs(tabs),
  };

  try {
    await invoke("write_workspace_config", {
      rootPath,
      config: updatedConfig,
    });
  } catch (error) {
    workspaceError("Failed to save workspace config:", error);
  }
}
