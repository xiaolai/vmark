/**
 * Workspace Config Helpers
 *
 * Purpose: Read/write workspace configuration to disk — merges partial
 *   updates into the current config and persists via Rust command.
 *
 * @coordinates-with workspaceStore.ts — in-memory config state
 * @module hooks/workspaceConfig
 */

import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";

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
    console.error("Failed to save workspace config:", error);
  }
}

export async function toggleShowHiddenFiles(): Promise<void> {
  const config = useWorkspaceStore.getState().config;
  const currentValue = config?.showHiddenFiles ?? false;
  await updateWorkspaceConfig({ showHiddenFiles: !currentValue });
}
