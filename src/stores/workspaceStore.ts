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
 *   - The config shape, its defaults and the normalizer live in
 *     workspaceConfigDefaults.ts. openWorkspace and bootstrapConfig share that
 *     ONE normalizer (defaults, identity, array copies, and the #1187 repair
 *     of app-created empty excludes), so a disk config lands in the same
 *     shape as a caller's — and then DEEP-CLONE it (audit #506): the
 *     normalizer copies the arrays but keeps nested `identity` / `ai` /
 *     `sessionTabs` by reference, and a caller that keeps mutating those would
 *     change persisted state and workspace trust behind set()'s back, the
 *     invariant updateConfig already clones for.
 *
 * Known limitations:
 *   - Config is stored in localStorage (via windowScopedStorage), not on
 *     disk — workspace settings don't transfer between machines.
 *   - No workspace indexing or search — only folder exclusion.
 *
 * @coordinates-with workspaceConfigDefaults.ts — config shape, defaults, normalizer
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
} from "@/utils/workspaceIdentity";
import { windowScopedStorage } from "@/services/persistence/workspaceStorage";
import { workspaceError } from "@/utils/debug";
import {
  DEFAULT_EXCLUDED_FOLDERS as DEFAULT_EXCLUDED_FOLDERS_SOURCE,
  normalizeWorkspaceConfig,
  type WorkspaceConfig,
} from "./workspaceConfigDefaults";
import { normalizeRehydratedConfig } from "./workspaceStorePersist";

export type { WorkspaceConfig };

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

/** Manages workspace folder state — open/close, config, excluded folders, and trust. Use selectors, not destructuring. */
export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>()(
  persist(
    (set, get) => ({
      rootPath: null,
      config: null,
      isWorkspaceMode: false,

      openWorkspace: (rootPath, config = null) => {
        // A BLANK root is not a workspace (audit #1012). `""` set
        // `isWorkspaceMode: true` alongside a falsy `rootPath`, and every
        // consumer reads that pair as closed — `bootstrapConfig` returns early
        // on `!rootPath`, `updateWorkspaceConfig` refuses the write — leaving a
        // window in workspace mode that nothing could configure or bootstrap.
        // Whitespace-only is the same non-path; a path with surrounding
        // whitespace is left alone, since a folder may legitimately be named
        // that way.
        if (rootPath.trim() === "") {
          workspaceError("Refusing to open a workspace with a blank root path");
          return;
        }
        set({
          rootPath,
          config: structuredClone(normalizeWorkspaceConfig(config)),
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
        set({ config: structuredClone(normalizeWorkspaceConfig(config)) });
      },

      updateConfig: (updates) => {
        const { config } = get();
        if (!config) return;

        // DEEP-clone the merged config (audit #1013), the same invariant
        // `openWorkspace` and `bootstrapConfig` already hold. The old
        // field-by-field copy listed three keys — excludeFolders, lastOpenTabs,
        // sessionTabs — and silently missed `identity` and `ai`, which are
        // nested objects too: a caller that kept mutating the identity it
        // passed in could flip workspace TRUST behind set()'s back, which is
        // the one field here with a security meaning. Enumerating the
        // clonable keys is how that gap appeared; cloning the whole thing
        // cannot regrow it.
        set({ config: structuredClone({ ...config, ...updates }) });
      },

      addExcludedFolder: (folder) => {
        const { config } = get();
        if (!config) return;

        // A SINGLE path segment, because that is the only thing the matcher can
        // ever match (audit #1014): `isPathExcluded` splits the relative path
        // and compares segments exactly, so `""` and `"src/vendor"` are entries
        // that persist forever and exclude nothing. Refused loudly rather than
        // stored as a rule that silently does not work. The value is stored as
        // given — a folder may legitimately be named with edge whitespace, the
        // same call `openWorkspace` makes about a blank root.
        if (folder.trim() === "" || /[\\/]/.test(folder)) {
          workspaceError(
            "Refusing to exclude a folder that is not a single path segment:",
            folder,
          );
          return;
        }

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

        const excludeFolders = config.excludeFolders.filter((f) => f !== folder);
        // Removing something that was never there is not a change (audit
        // #1015). Writing anyway notified every subscriber and wrote the whole
        // config back to storage for nothing.
        if (excludeFolders.length === config.excludeFolders.length) return;

        set({ config: { ...config, excludeFolders } });
      },

      // ONE mutation path (audit #1016). This was a second implementation of
      // `updateConfig({ lastOpenTabs })` — same merge, same clone, written
      // twice — so the two could drift on validation or on cloning depth, and
      // the deep-clone fix above would have landed on only one of them.
      setLastOpenTabs: (tabs) => get().updateConfig({ lastOpenTabs: tabs }),

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
      // Persisted state is NORMALIZED on the way back in (audit #1017).
      // zustand's default merge is a shallow object copy, so a config written
      // by an older build — or edited in localStorage — used to reach live
      // state without passing the normalizer every other entry point runs.
      // See workspaceStorePersist.ts for why there is no version/migrate pair.
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<WorkspaceState> | null) };
        return { ...merged, config: normalizeRehydratedConfig(merged.config) };
      },
      // CRITICAL: Skip auto-hydration on store creation.
      // WindowContext will call setCurrentWindowLabel() first, then rehydrate()
      // to ensure each window reads from its own storage key.
      skipHydration: true,
    }
  )
);

/**
 * Default excluded folders, FROZEN (audit #1018).
 *
 * This is the array every future workspace's `excludeFolders` is copied from,
 * and re-exporting it live meant any consumer could `push` into it and change
 * what every later workspace excludes — from anywhere, permanently, with no
 * store action involved. `Object.freeze` returns its argument, so this stays
 * the SAME array the normalizer copies (one identity, not a divergent copy),
 * and `readonly string[]` makes the refusal a compile error rather than a
 * silent no-op in non-strict code.
 */
export const DEFAULT_EXCLUDED_FOLDERS: readonly string[] = Object.freeze(
  DEFAULT_EXCLUDED_FOLDERS_SOURCE,
);

// ============================================================================
// Recent Files / Recent Workspaces — live in recentsStore.ts (split for the
// SH-3 multi-window merge work; formerly T09's inlined recentFilesStore.ts /
// recentWorkspacesStore.ts). Re-exported so existing
// "@/stores/workspaceStore" imports keep working.
// ============================================================================

export {
  useRecentFilesStore,
  useRecentWorkspacesStore,
} from "@/stores/recentsStore";
