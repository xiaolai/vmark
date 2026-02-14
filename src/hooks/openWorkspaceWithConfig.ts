/**
 * Open Workspace With Config
 *
 * Purpose: Opens a workspace by reading its config from disk (if available)
 *   and updating the workspace store — returns the config for callers
 *   that need to restore tabs or apply settings.
 *
 * @coordinates-with workspaceStore.ts — openWorkspace action
 * @module hooks/openWorkspaceWithConfig
 */

import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
export async function openWorkspaceWithConfig(
  rootPath: string
): Promise<WorkspaceConfig | null> {
  try {
    const config = await invoke<WorkspaceConfig | null>("read_workspace_config", {
      rootPath,
    });
    useWorkspaceStore.getState().openWorkspace(rootPath, config);
    return config;
  } catch (error) {
    console.error("[Workspace] Failed to load config:", error);
    useWorkspaceStore.getState().openWorkspace(rootPath);
    return null;
  }
}
