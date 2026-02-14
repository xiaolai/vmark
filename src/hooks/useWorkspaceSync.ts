/**
 * Workspace Sync Hook
 *
 * Purpose: Synchronizes workspace config changes across windows using
 *   localStorage storage events. When the settings window updates
 *   workspace config, document windows pick up the change and rehydrate.
 *
 * @coordinates-with workspaceStorage.ts — key derivation for matching events
 * @coordinates-with workspaceStore.ts — rehydrates store on external changes
 * @module hooks/useWorkspaceSync
 */

import { useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { getWorkspaceStorageKey, getCurrentWindowLabel } from "@/utils/workspaceStorage";

/**
 * Listens for cross-window workspace storage changes and rehydrates the store.
 * Use in document windows (MainLayout) to pick up config changes from settings.
 */
export function useWorkspaceSync() {
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      const expectedKey = getWorkspaceStorageKey(getCurrentWindowLabel());
      if (event.key !== expectedKey) return;
      try {
        useWorkspaceStore.persist.rehydrate();
      } catch (e) {
        console.warn("[WorkspaceSync] Rehydration failed:", e);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
}
