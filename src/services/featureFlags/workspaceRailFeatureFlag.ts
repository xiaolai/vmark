/**
 * Workspace Rail Feature Flag
 *
 * Reads from settingsStore.general.workspaceRailMode (persisted).
 */

import { useSettingsStore } from "@/stores/settingsStore";

/** Check if the workspace rail/window model is enabled for imperative code. */
export function isWorkspaceRailEnabled(): boolean {
  return useSettingsStore.getState().general?.workspaceRailMode ?? false;
}
