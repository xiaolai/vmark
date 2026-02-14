/**
 * Recent Workspaces Store
 *
 * Purpose: Tracks recently opened workspace folders (max 10) with persistence
 *   via zustand/persist. Syncs the list to the native File > Recent Workspaces menu.
 *
 * Pipeline: Workspace opened → addWorkspace(path) → MRU list updated → Rust
 *   update_recent_workspaces rebuilds native menu submenu.
 *
 * @coordinates-with recentFilesStore.ts — same pattern for individual files
 * @coordinates-with menu.rs — native Recent Workspaces submenu
 * @module stores/recentWorkspacesStore
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { getFileName } from "@/utils/pathUtils";

export interface RecentWorkspace {
  path: string;       // Absolute path to workspace folder
  name: string;       // Folder name for display
  timestamp: number;  // Last opened time
}

interface RecentWorkspacesState {
  workspaces: RecentWorkspace[];
  maxWorkspaces: number;
  addWorkspace: (path: string) => void;
  removeWorkspace: (path: string) => void;
  clearAll: () => void;
  syncToNativeMenu: () => void;
}

// Helper to sync workspaces to native menu
async function updateNativeMenu(workspaces: RecentWorkspace[]) {
  try {
    await invoke("update_recent_workspaces", { workspaces: workspaces.map((w) => w.path) });
  } catch (error) {
    console.warn("[RecentWorkspaces] Failed to update native menu:", error);
  }
}

export const useRecentWorkspacesStore = create<RecentWorkspacesState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      maxWorkspaces: 10,

      addWorkspace: (path: string) => {
        const { workspaces, maxWorkspaces } = get();
        const name = getFileName(path) || path;

        // Remove if already exists (will be re-added at top)
        const filtered = workspaces.filter((w) => w.path !== path);

        // Add to front
        const newWorkspaces = [
          { path, name, timestamp: Date.now() },
          ...filtered,
        ].slice(0, maxWorkspaces);

        set({ workspaces: newWorkspaces });
        updateNativeMenu(newWorkspaces);
      },

      removeWorkspace: (path: string) => {
        const newWorkspaces = get().workspaces.filter((w) => w.path !== path);
        set({ workspaces: newWorkspaces });
        updateNativeMenu(newWorkspaces);
      },

      clearAll: () => {
        set({ workspaces: [] });
        updateNativeMenu([]);
      },

      syncToNativeMenu: () => {
        updateNativeMenu(get().workspaces);
      },
    }),
    {
      name: "vmark-recent-workspaces",
    }
  )
);
