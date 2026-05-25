/**
 * Recent Workspaces Sync Hook
 *
 * Purpose: Syncs the recent workspaces list to the native macOS menu on startup —
 *   needed because Zustand persist rehydration runs before Tauri APIs are ready.
 *
 * @coordinates-with recentWorkspacesStore.ts — syncToNativeMenu action
 * @module hooks/useRecentWorkspacesSync
 */

import { useEffect } from "react";
import { useRecentWorkspacesStore } from "@/stores/workspaceStore";

/** Hook that syncs the recent workspaces list to the native macOS menu on mount. */
export function useRecentWorkspacesSync() {
  useEffect(() => {
    // Sync recent workspaces to native menu on mount
    useRecentWorkspacesStore.getState().syncToNativeMenu();
  }, []);
}
