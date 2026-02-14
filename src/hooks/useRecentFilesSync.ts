/**
 * Recent Files Sync Hook
 *
 * Purpose: Syncs the recent files list to the native macOS menu on app startup —
 *   needed because Zustand persist rehydration runs before Tauri APIs are ready.
 *
 * @coordinates-with recentFilesStore.ts — syncToNativeMenu action
 * @module hooks/useRecentFilesSync
 */

import { useEffect } from "react";
import { useRecentFilesStore } from "@/stores/recentFilesStore";

export function useRecentFilesSync() {
  useEffect(() => {
    // Sync recent files to native menu on mount
    useRecentFilesStore.getState().syncToNativeMenu();
  }, []);
}
