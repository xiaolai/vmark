import { create } from "zustand";
import { persist } from "zustand/middleware";

// Workspace configuration stored in .vmark file
export interface WorkspaceConfig {
  version: 1;
  excludeFolders: string[];
  lastOpenTabs: string[]; // File paths for session restore
  ai?: Record<string, unknown>; // Future AI settings
}

// Runtime workspace state
interface WorkspaceState {
  rootPath: string | null;
  config: WorkspaceConfig | null;
  isWorkspaceMode: boolean; // true if opened via "Open Folder"
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

  // Selectors
  isPathExcluded: (path: string) => boolean;
}

const DEFAULT_EXCLUDED_FOLDERS = [".git", "node_modules", ".vmark"];

const DEFAULT_CONFIG: WorkspaceConfig = {
  version: 1,
  excludeFolders: DEFAULT_EXCLUDED_FOLDERS,
  lastOpenTabs: [],
};

export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>()(
  persist(
    (set, get) => ({
      rootPath: null,
      config: null,
      isWorkspaceMode: false,

      openWorkspace: (rootPath, config = null) => {
        set({
          rootPath,
          config: config ?? { ...DEFAULT_CONFIG },
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
          config: config ?? { ...DEFAULT_CONFIG },
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

      isPathExcluded: (path) => {
        const { config, rootPath } = get();
        if (!config || !rootPath) return false;

        // Check if any segment of the path matches excluded folders
        const relativePath = path.startsWith(rootPath)
          ? path.slice(rootPath.length + 1)
          : path;

        const segments = relativePath.split("/");
        return segments.some((segment) =>
          config.excludeFolders.includes(segment)
        );
      },
    }),
    {
      name: "vmark-workspace",
      // Only persist workspace path, not config (config comes from .vmark file)
      partialize: (state) => ({
        rootPath: state.rootPath,
        isWorkspaceMode: state.isWorkspaceMode,
      }),
    }
  )
);

// Default excluded folders for reference
export { DEFAULT_EXCLUDED_FOLDERS };
