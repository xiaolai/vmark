/**
 * Workspace Config Helpers
 *
 * Purpose: Read/write workspace configuration to disk — merges partial
 *   updates into the current config and persists via Rust command.
 *
 * @coordinates-with workspaceStore.ts — in-memory config state
 * @module services/workspaces/workspaceConfig
 */

import { invoke } from "@tauri-apps/api/core";
import { workspaceError } from "@/utils/debug";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";

/**
 * Merge partial updates into the workspace config and persist them.
 * Returns whether the change actually reached disk.
 *
 * The store is updated optimistically so the UI responds immediately, but a
 * failed write is ROLLED BACK: leaving the optimistic value in place made a
 * toggle look saved and then quietly revert on the next launch, which is worse
 * than one that refuses. Callers that ignore the result still get the toast.
 */
export async function updateWorkspaceConfig(
  updates: Partial<WorkspaceConfig>
): Promise<boolean> {
  const { rootPath, config, isWorkspaceMode } = useWorkspaceStore.getState();

  if (!isWorkspaceMode || !rootPath || !config) {
    return false;
  }

  const updatedConfig = { ...config, ...updates };
  // Only the touched keys, so a rollback cannot resurrect unrelated stale state.
  const previous = Object.fromEntries(
    Object.keys(updates).map((key) => [key, config[key as keyof WorkspaceConfig]]),
  ) as Partial<WorkspaceConfig>;
  useWorkspaceStore.getState().updateConfig(updates);

  try {
    await invoke("write_workspace_config", {
      rootPath,
      config: updatedConfig,
    });
    return true;
  } catch (error) {
    workspaceError("Failed to save workspace config:", error);
    useWorkspaceStore.getState().updateConfig(previous);
    toast.error(i18n.t("dialog:toast.workspaceConfigSaveFailed"));
    return false;
  }
}

/** Toggles showHiddenFiles and persists it. Returns whether it stuck. */
export async function toggleShowHiddenFiles(): Promise<boolean> {
  const config = useWorkspaceStore.getState().config;
  const currentValue = config?.showHiddenFiles ?? false;
  return updateWorkspaceConfig({ showHiddenFiles: !currentValue });
}

/** Toggles showAllFiles and persists it. Returns whether it stuck. */
export async function toggleShowAllFiles(): Promise<boolean> {
  const config = useWorkspaceStore.getState().config;
  const currentValue = config?.showAllFiles ?? false;
  return updateWorkspaceConfig({ showAllFiles: !currentValue });
}
