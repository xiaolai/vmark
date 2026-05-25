/**
 * Workspace Store
 *
 * Purpose: Manages workspace (folder) state — open/close, config, excluded
 *   folders, trust management, and session restore via lastOpenTabs.
 *
 * Key decisions:
 *   - Uses window-scoped storage so each Tauri window persists its own
 *     workspace independently. skipHydration is set to true — WindowContext
 *     calls setCurrentWindowLabel() then rehydrate() at mount time.
 *   - Workspace identity (UUID + trust) enables future features like
 *     workspace-scoped AI settings and security gating.
 *   - Default excluded folders (.git, node_modules) are merged on open
 *     to ensure new defaults propagate to existing workspaces.
 *
 * Known limitations:
 *   - Config is stored in localStorage (via windowScopedStorage), not on
 *     disk — workspace settings don't transfer between machines.
 *   - No workspace indexing or search — only folder exclusion.
 *
 * @coordinates-with tabStore.ts — lastOpenTabs drives session restore
 * @coordinates-with useWorkspaceBootstrap.ts — loads config from Tauri on startup
 * @module stores/workspaceStore
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { isPathExcluded as checkPathExcluded } from "@/utils/paths";
import {
  createWorkspaceIdentity,
  grantTrust,
  revokeTrust,
  isTrusted,
  type WorkspaceIdentity,
} from "@/utils/workspaceIdentity";
import { windowScopedStorage } from "@/utils/workspaceStorage";
import { createSafeStorage } from "@/utils/safeStorage";
import { invoke } from "@tauri-apps/api/core";
import { getFileName } from "@/utils/pathUtils";
import { recentWarn } from "@/utils/debug";

/** Workspace configuration — excluded folders, session restore tabs, file visibility, and trust identity. */
export interface WorkspaceConfig {
  version: 1;
  excludeFolders: string[];
  lastOpenTabs: string[]; // File paths for session restore
  showHiddenFiles: boolean;
  showAllFiles: boolean; // Show non-markdown files in the file explorer
  ai?: Record<string, unknown>; // Future AI settings
  identity?: WorkspaceIdentity; // Workspace identity and trust info
}

// Runtime workspace state
interface WorkspaceState {
  rootPath: string | null;
  config: WorkspaceConfig | null;
  isWorkspaceMode: boolean; // true if opened via "Open Workspace"
}

interface WorkspaceActions {
  // Workspace management
  openWorkspace: (rootPath: string, config?: WorkspaceConfig | null) => void;
  closeWorkspace: () => void;
  updateConfig: (updates: Partial<WorkspaceConfig>) => void;

  // Bootstrap: load config on restart when rootPath was persisted
  bootstrapConfig: (config: WorkspaceConfig | null) => void;

  // Config helpers
  addExcludedFolder: (folder: string) => void;
  removeExcludedFolder: (folder: string) => void;
  setLastOpenTabs: (tabs: string[]) => void;

  // Trust management
  trustWorkspace: () => void;
  untrustWorkspace: () => void;

  // Selectors
  isPathExcluded: (path: string) => boolean;
  isWorkspaceTrusted: () => boolean;
  getWorkspaceId: () => string | null;
}

const DEFAULT_EXCLUDED_FOLDERS = [".git", "node_modules"];

const DEFAULT_CONFIG: WorkspaceConfig = {
  version: 1,
  excludeFolders: DEFAULT_EXCLUDED_FOLDERS,
  lastOpenTabs: [],
  showHiddenFiles: false,
  showAllFiles: false,
};

/** Manages workspace folder state — open/close, config, excluded folders, and trust. Use selectors, not destructuring. */
export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>()(
  persist(
    (set, get) => ({
      rootPath: null,
      config: null,
      isWorkspaceMode: false,

      openWorkspace: (rootPath, config = null) => {
        // Merge defaults to ensure new fields are populated
        const finalConfig = { ...DEFAULT_CONFIG, ...(config ?? {}) };
        // Ensure workspace has an identity
        if (!finalConfig.identity) {
          finalConfig.identity = createWorkspaceIdentity();
        }
        set({
          rootPath,
          config: finalConfig,
          isWorkspaceMode: true,
        });
      },

      closeWorkspace: () => {
        set({
          rootPath: null,
          config: null,
          isWorkspaceMode: false,
        });
      },

      bootstrapConfig: (config) => {
        const { rootPath, isWorkspaceMode } = get();
        // Only bootstrap if we have a workspace but no config
        if (!rootPath || !isWorkspaceMode) return;

        set({
          config: config ? { ...DEFAULT_CONFIG, ...config } : { ...DEFAULT_CONFIG },
        });
      },

      updateConfig: (updates) => {
        const { config } = get();
        if (!config) return;

        set({
          config: { ...config, ...updates },
        });
      },

      addExcludedFolder: (folder) => {
        const { config } = get();
        if (!config) return;

        if (!config.excludeFolders.includes(folder)) {
          set({
            config: {
              ...config,
              excludeFolders: [...config.excludeFolders, folder],
            },
          });
        }
      },

      removeExcludedFolder: (folder) => {
        const { config } = get();
        if (!config) return;

        set({
          config: {
            ...config,
            excludeFolders: config.excludeFolders.filter((f) => f !== folder),
          },
        });
      },

      setLastOpenTabs: (tabs) => {
        const { config } = get();
        if (!config) return;

        set({
          config: {
            ...config,
            lastOpenTabs: tabs,
          },
        });
      },

      trustWorkspace: () => {
        const { config } = get();
        if (!config) return;

        // Ensure identity exists, then grant trust
        const identity = config.identity ?? createWorkspaceIdentity();
        set({
          config: {
            ...config,
            identity: grantTrust(identity),
          },
        });
      },

      untrustWorkspace: () => {
        const { config } = get();
        if (!config || !config.identity) return;

        set({
          config: {
            ...config,
            identity: revokeTrust(config.identity),
          },
        });
      },

      isPathExcluded: (path) => {
        const { config, rootPath } = get();
        if (!config || !rootPath) return false;

        return checkPathExcluded(path, rootPath, config.excludeFolders);
      },

      isWorkspaceTrusted: () => {
        const { config } = get();
        return isTrusted(config?.identity);
      },

      getWorkspaceId: () => {
        const { config } = get();
        return config?.identity?.id ?? null;
      },
    }),
    {
      // Name is ignored by windowScopedStorage (uses window label instead)
      name: "vmark-workspace",
      // Use window-scoped storage for per-window workspace persistence
      storage: createJSONStorage(() => windowScopedStorage),
      // Persist workspace state including config for seamless reload
      partialize: (state) => ({
        rootPath: state.rootPath,
        isWorkspaceMode: state.isWorkspaceMode,
        config: state.config,
      }),
      // CRITICAL: Skip auto-hydration on store creation.
      // WindowContext will call setCurrentWindowLabel() first, then rehydrate()
      // to ensure each window reads from its own storage key.
      skipHydration: true,
    }
  )
);

// Default excluded folders for reference
export { DEFAULT_EXCLUDED_FOLDERS };

// ============================================================================
// Recent Files (T09 — formerly recentFilesStore.ts)
// ============================================================================

export interface RecentFile {
  path: string;
  name: string;
  timestamp: number;
}

interface RecentFilesState {
  files: RecentFile[];
  maxFiles: number;
  addFile: (path: string) => void;
  removeFile: (path: string) => void;
  clearAll: () => void;
  syncToNativeMenu: () => void;
}

async function updateRecentFilesNativeMenu(files: RecentFile[]) {
  try {
    await invoke("update_recent_files", { files: files.map((f) => f.path) });
  } catch (error) {
    recentWarn("Failed to update recent files native menu:", error);
  }
}

async function registerDockRecent(path: string) {
  try {
    await invoke("register_dock_recent", { path });
  } catch {
    /* macOS-only command; silent on other platforms */
  }
}

/** Manages recently opened files (max 10) with persistence and native menu sync. */
export const useRecentFilesStore = create<RecentFilesState>()(
  persist(
    (set, get) => ({
      files: [],
      maxFiles: 10,
      addFile: (path: string) => {
        const { files, maxFiles } = get();
        const name = getFileName(path) || path;
        const filtered = files.filter((f) => f.path !== path);
        const newFiles = [
          { path, name, timestamp: Date.now() },
          ...filtered,
        ].slice(0, maxFiles);
        set({ files: newFiles });
        updateRecentFilesNativeMenu(newFiles);
        registerDockRecent(path);
      },
      removeFile: (path: string) => {
        const newFiles = get().files.filter((f) => f.path !== path);
        set({ files: newFiles });
        updateRecentFilesNativeMenu(newFiles);
      },
      clearAll: () => {
        set({ files: [] });
        updateRecentFilesNativeMenu([]);
      },
      syncToNativeMenu: () => {
        updateRecentFilesNativeMenu(get().files);
      },
    }),
    {
      name: "vmark-recent-files",
      storage: createJSONStorage(() => createSafeStorage()),
    },
  ),
);

// ============================================================================
// Recent Workspaces (T09 — formerly recentWorkspacesStore.ts)
// ============================================================================

export interface RecentWorkspace {
  path: string;
  name: string;
  timestamp: number;
}

interface RecentWorkspacesState {
  workspaces: RecentWorkspace[];
  maxWorkspaces: number;
  addWorkspace: (path: string) => void;
  removeWorkspace: (path: string) => void;
  clearAll: () => void;
  syncToNativeMenu: () => void;
}

async function updateRecentWorkspacesNativeMenu(workspaces: RecentWorkspace[]) {
  try {
    await invoke("update_recent_workspaces", {
      workspaces: workspaces.map((w) => w.path),
    });
  } catch (error) {
    recentWarn("Failed to update recent workspaces native menu:", error);
  }
}

/** Manages recently opened workspaces (max 10) with persistence and native menu sync. */
export const useRecentWorkspacesStore = create<RecentWorkspacesState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      maxWorkspaces: 10,
      addWorkspace: (path: string) => {
        const { workspaces, maxWorkspaces } = get();
        const name = getFileName(path) || path;
        const filtered = workspaces.filter((w) => w.path !== path);
        const newWorkspaces = [
          { path, name, timestamp: Date.now() },
          ...filtered,
        ].slice(0, maxWorkspaces);
        set({ workspaces: newWorkspaces });
        updateRecentWorkspacesNativeMenu(newWorkspaces);
      },
      removeWorkspace: (path: string) => {
        const newWorkspaces = get().workspaces.filter((w) => w.path !== path);
        set({ workspaces: newWorkspaces });
        updateRecentWorkspacesNativeMenu(newWorkspaces);
      },
      clearAll: () => {
        set({ workspaces: [] });
        updateRecentWorkspacesNativeMenu([]);
      },
      syncToNativeMenu: () => {
        updateRecentWorkspacesNativeMenu(get().workspaces);
      },
    }),
    {
      name: "vmark-recent-workspaces",
      storage: createJSONStorage(() => createSafeStorage()),
    },
  ),
);
