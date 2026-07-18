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
 *     to ensure new defaults propagate to existing workspaces. openWorkspace
 *     and bootstrapConfig share ONE normalizer (defaults, identity, array
 *     copies), so a disk config lands in the same shape as a caller's.
 *
 * Known limitations:
 *   - Config is stored in localStorage (via windowScopedStorage), not on
 *     disk — workspace settings don't transfer between machines.
 *   - No workspace indexing or search — only folder exclusion.
 *
 * @coordinates-with tabStore.ts — lastOpenTabs drives session restore
 * @coordinates-with useWorkspaceBootstrap.ts — loads config from Tauri on startup
 * @coordinates-with recentsStore.ts — recent files/workspaces (re-exported here)
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
import { windowScopedStorage } from "@/services/persistence/workspaceStorage";
import type { SessionTabsV1 } from "@/services/persistence/sessionTabs";

/** Workspace configuration — excluded folders, session restore tabs, file visibility, and trust identity. */
export interface WorkspaceConfig {
  version: 1;
  excludeFolders: string[];
  lastOpenTabs: string[]; // Doc paths for session restore (legacy; kept for older builds)
  /** WI-1.1 — full ordered tab list (documents + browser tabs). Written by
   *  workspaceSession.ts, read back by sessionTabs.ts; the Rust side keeps it
   *  as an opaque JSON value, so the schema lives on this side. */
  sessionTabs?: SessionTabsV1;
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

/**
 * Bring any config (from disk, from a caller, or none at all) to the shape the
 * store guarantees: defaults filled in, an identity present (trust gating reads
 * it), and no array shared with the module defaults or the caller — live state
 * that aliases `DEFAULT_EXCLUDED_FOLDERS` would let one in-place mutation
 * corrupt every future workspace.
 *
 * Both entry points (openWorkspace, bootstrapConfig) run this, so a bootstrapped
 * workspace can't end up without the identity an opened one always gets.
 */
function normalizeWorkspaceConfig(config?: WorkspaceConfig | null): WorkspaceConfig {
  const source: Partial<WorkspaceConfig> = config ?? {};
  return {
    version: 1,
    showHiddenFiles: false,
    showAllFiles: false,
    ...source,
    excludeFolders: [...(source.excludeFolders ?? DEFAULT_EXCLUDED_FOLDERS)],
    lastOpenTabs: [...(source.lastOpenTabs ?? [])],
    identity: source.identity ?? createWorkspaceIdentity(),
  };
}

/** Manages workspace folder state — open/close, config, excluded folders, and trust. Use selectors, not destructuring. */
export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>()(
  persist(
    (set, get) => ({
      rootPath: null,
      config: null,
      isWorkspaceMode: false,

      openWorkspace: (rootPath, config = null) => {
        set({
          rootPath,
          config: normalizeWorkspaceConfig(config),
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
        // Only bootstrap when a workspace is actually open
        if (!rootPath || !isWorkspaceMode) return;

        // Same normalization as openWorkspace — a legacy on-disk config without
        // an identity gets one here too, or trust gating would read undefined.
        set({ config: normalizeWorkspaceConfig(config) });
      },

      updateConfig: (updates) => {
        const { config } = get();
        if (!config) return;

        // Clone caller-owned mutable fields — a caller that keeps
        // mutating its array after the call must not be able to change
        // store state behind set()'s back.
        const next: WorkspaceConfig = { ...config, ...updates };
        if (updates.excludeFolders) {
          next.excludeFolders = [...updates.excludeFolders];
        }
        if (updates.lastOpenTabs) {
          next.lastOpenTabs = [...updates.lastOpenTabs];
        }
        if (updates.sessionTabs) {
          next.sessionTabs = {
            ...updates.sessionTabs,
            tabs: updates.sessionTabs.tabs.map((tab) => ({ ...tab })),
          };
        }

        set({ config: next });
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
            // Clone — the caller may keep mutating its array afterwards.
            lastOpenTabs: [...tabs],
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
// Recent Files / Recent Workspaces — live in recentsStore.ts (split for the
// SH-3 multi-window merge work; formerly T09's inlined recentFilesStore.ts /
// recentWorkspacesStore.ts). Re-exported so existing
// "@/stores/workspaceStore" imports keep working.
// ============================================================================

export {
  useRecentFilesStore,
  useRecentWorkspacesStore,
  type RecentFile,
  type RecentWorkspace,
} from "@/stores/recentsStore";
