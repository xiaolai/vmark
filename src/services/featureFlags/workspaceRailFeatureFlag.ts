/**
 * Workspace Rail Feature Flag
 *
 * Reads from settingsStore.advanced.workspaceRailMode (persisted).
 * Keep this disabled by default until the rail/window model gates pass.
 */

import { useSettingsStore } from "@/stores/settingsStore";

/** Check if the workspace rail/window model is enabled for imperative code. */
export function isWorkspaceRailEnabled(): boolean {
  return useSettingsStore.getState().advanced?.workspaceRailMode ?? false;
}
