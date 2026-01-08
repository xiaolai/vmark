/**
 * Workspace Bootstrap Logic
 *
 * Pure helper for determining when workspace config needs to be loaded from disk.
 * The Zustand persist middleware restores rootPath but not config,
 * so we need to reload config on app startup.
 *
 * Decision logic:
 * - If rootPath exists and isWorkspaceMode true, but config is null → need bootstrap
 * - Otherwise → no bootstrap needed
 */

import type { WorkspaceConfig } from "@/stores/workspaceStore";

/**
 * Minimal state interface for bootstrap decision.
 * Matches the persisted fields from workspaceStore.
 */
export interface WorkspaceBootstrapState {
  rootPath: string | null;
  config: WorkspaceConfig | null;
  isWorkspaceMode: boolean;
}

/**
 * Determine if workspace config needs to be loaded from disk.
 *
 * This handles the case where the app restarts and rootPath is restored
 * from localStorage, but config (which comes from the workspace file)
 * is not yet loaded.
 *
 * @param state - Current workspace state
 * @returns true if bootstrap is needed (config should be loaded)
 */
export function needsBootstrap(state: WorkspaceBootstrapState): boolean {
  // If not in workspace mode, no bootstrap needed
  if (!state.isWorkspaceMode) {
    return false;
  }

  // If no rootPath, can't bootstrap
  if (!state.rootPath) {
    return false;
  }

  // If config already loaded, no bootstrap needed
  if (state.config !== null) {
    return false;
  }

  // rootPath exists, in workspace mode, but config is null → need bootstrap
  return true;
}
