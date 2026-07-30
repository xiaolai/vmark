/**
 * Legacy workspace-store sync on rail activation (WI-5R).
 *
 * Purpose: the sidebar file tree (and exclude-folders / hidden-files
 * filtering) reads the LEGACY `useWorkspaceStore`. Activating a rail instance
 * must therefore re-root that store — SYNCHRONOUSLY, so the tree and the tab
 * strip switch in the same frame (no B-tabs-with-A-sidebar window), followed
 * by an async on-disk config refresh guarded by the context generation.
 *
 * Kind rules (plan D-decisions):
 *   - workspace   → openWorkspace(rootPath) now; refresh config from disk.
 *   - loose       → closeWorkspace() (no root, no tree — deliberate).
 *   - placeholder → closeWorkspace() TOO: after closing the active workspace,
 *     a placeholder fallback must not leave the old root's tree visible under
 *     an Untitled rail entry.
 *
 * Failure policy: config read rejection or a malformed payload keeps the
 * synchronous defaults and logs — the switch itself never fails on disk I/O.
 *
 * @coordinates-with switchWorkspaceInstance.ts — calls this after activation
 * @coordinates-with workspaceContextGeneration.ts — stale-completion guard
 * @coordinates-with openWorkspaceWithConfig.ts — the OPEN-path writer (13.3)
 * @module services/workspaces/syncLegacyWorkspaceContext
 */
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { workspaceError } from "@/utils/debug";
import { isValidWorkspaceConfig } from "./workspaceConfigGuard";
import { isCurrentContextGeneration } from "./workspaceContextGeneration";

export interface LegacySyncTarget {
  kind: "workspace" | "loose" | "placeholder";
  rootPath: string | null;
}

/**
 * Apply the incoming instance's context to the legacy workspace store.
 * Synchronous re-root happens before this returns; the returned promise
 * settles when the async config refresh completed (or was discarded).
 *
 * `preloadedConfig` (WI-13.3): the OPEN path already read the config from
 * disk — passing it (config object, or null for "no config file") applies it
 * synchronously and skips the duplicate disk read entirely. `undefined`
 * means "not preloaded" (rail click) → async refresh from disk.
 */
export function syncLegacyWorkspaceContext(
  windowLabel: string,
  target: LegacySyncTarget,
  generation: number,
  preloadedConfig?: WorkspaceConfig | null,
): Promise<void> {
  const railEnabled = useSettingsStore.getState().general?.workspaceRailMode ?? false;
  if (!railEnabled) return Promise.resolve();
  // The window already moved on — applying even the synchronous part would
  // fight the newer switch.
  if (!isCurrentContextGeneration(windowLabel, generation)) return Promise.resolve();

  if (target.kind !== "workspace" || !target.rootPath) {
    useWorkspaceStore.getState().closeWorkspace();
    return Promise.resolve();
  }

  const rootPath = target.rootPath;
  if (preloadedConfig !== undefined) {
    // Defense in depth (audit R2-F9): callers validate, but this is
    // disk-derived data — re-check before applying; malformed → defaults.
    const valid = preloadedConfig === null || isValidWorkspaceConfig(preloadedConfig);
    if (!valid) workspaceError("Malformed preloaded config; applying defaults:", preloadedConfig);
    useWorkspaceStore.getState().openWorkspace(rootPath, valid ? preloadedConfig : null);
    return Promise.resolve();
  }

  // Synchronous re-root with normalized defaults; the tree switches NOW.
  useWorkspaceStore.getState().openWorkspace(rootPath);

  return invoke<WorkspaceConfig | null>("read_workspace_config", { rootPath })
    .then((config) => {
      if (!isCurrentContextGeneration(windowLabel, generation)) return;
      if (config === null) return; // no config file — defaults already applied
      if (!isValidWorkspaceConfig(config)) {
        workspaceError("Malformed workspace config on rail switch; keeping defaults:", config);
        return;
      }
      useWorkspaceStore.getState().openWorkspace(rootPath, config);
    })
    .catch((error) => {
      workspaceError("Workspace config refresh failed on rail switch:", error);
    });
}
