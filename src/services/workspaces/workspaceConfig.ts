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
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";

/** Merges partial updates into the workspace config and persists to disk via Rust. */
export async function updateWorkspaceConfig(
  updates: Partial<WorkspaceConfig>
): Promise<void> {
  const { rootPath, config, isWorkspaceMode } = useWorkspaceStore.getState();

  if (!isWorkspaceMode || !rootPath || !config) {
    return;
  }

  const updatedConfig = { ...config, ...updates };
  useWorkspaceStore.getState().updateConfig(updates);

  try {
    await invoke("write_workspace_config", {
      rootPath,
      config: updatedConfig,
    });
  } catch (error) {
    workspaceError("Failed to save workspace config:", error);
  }
}

/** Toggles the showHiddenFiles workspace config flag and persists the change. */
export async function toggleShowHiddenFiles(): Promise<void> {
  const config = useWorkspaceStore.getState().config;
  const currentValue = config?.showHiddenFiles ?? false;
  await updateWorkspaceConfig({ showHiddenFiles: !currentValue });
}

/** Toggles the showAllFiles workspace config flag and persists the change. */
export async function toggleShowAllFiles(): Promise<void> {
  const config = useWorkspaceStore.getState().config;
  const currentValue = config?.showAllFiles ?? false;
  await updateWorkspaceConfig({ showAllFiles: !currentValue });
}
