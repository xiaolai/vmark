/**
 * Open Workspace With Config
 *
 * Purpose: Opens a workspace by reading its config from disk (if available)
 *   and updating the workspace store — returns the config for callers
 *   that need to restore tabs or apply settings.
 *
 * @coordinates-with workspaceStore.ts — openWorkspace action
 * @coordinates-with utils/macQuarantineNotice.ts — clears quarantine on macOS
 * @module services/workspaces/openWorkspaceWithConfig
 */

import { invoke } from "@tauri-apps/api/core";
import { isValidWorkspaceConfig } from "./workspaceConfigGuard";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { workspaceError } from "@/utils/debug";
import { maybeStripMacQuarantine } from "@/services/macos/macQuarantineNotice";
import {
  openOrActivateWorkspaceInstance,
  resolveStableRootPath,
  type OpenWorkspaceInstanceOptions,
} from "@/services/workspaces/workspaceInstanceActions";

// Guard extracted to workspaceConfigGuard.ts (WI-13.3, cycle break);
// re-exported here for existing consumers.
export { isValidWorkspaceConfig } from "./workspaceConfigGuard";

/**
 * Open the workspace store with built-in defaults (no on-disk config) and
 * register/activate its rail instance. Shared fallback for both the malformed-
 * payload and invoke-error branches so the two paths cannot drift.
 */
function openWorkspaceWithDefaults(
  rootPath: string,
  options: OpenWorkspaceInstanceOptions,
): null {
  useWorkspaceStore.getState().openWorkspace(rootPath);
  openOrActivateWorkspaceInstance(rootPath, { ...options, preloadedConfig: null });
  return null;
}

/** Reads workspace config from disk and opens the workspace in the store; returns the config or null on failure. */
export async function openWorkspaceWithConfig(
  rootPath: string,
  options: OpenWorkspaceInstanceOptions = {},
): Promise<WorkspaceConfig | null> {
  // WI-17.2: a variant spelling of an already-railed root must address the
  // SAME config file and instance — resolve to the stored spelling first.
  rootPath = resolveStableRootPath(options.windowLabel ?? "main", rootPath, options.platform);
  // Fire-and-forget quarantine strip — settling does not block workspace open.
  // Awaited only conceptually: it's intentionally not blocking the read below.
  void maybeStripMacQuarantine(rootPath);
  try {
    const config = await invoke<WorkspaceConfig | null>("read_workspace_config", {
      rootPath,
    });
    // A null config (no config file on disk) is valid — open with store
    // defaults. A non-null but malformed payload is rejected loudly (T1/ADR-2)
    // and treated as "no config" rather than propagating bad shape into the
    // workspace store and onward to tab restore / file filtering.
    if (config !== null && !isValidWorkspaceConfig(config)) {
      workspaceError("Malformed workspace config payload; opening with defaults:", config);
      return openWorkspaceWithDefaults(rootPath, options);
    }
    useWorkspaceStore.getState().openWorkspace(rootPath, config);
    // WI-13.3: hand the just-read config to the rail coordinator so an
    // already-railed root's full context switch does not re-read the disk.
    openOrActivateWorkspaceInstance(rootPath, { ...options, preloadedConfig: config });
    return config;
  } catch (error) {
    workspaceError("Failed to load config:", error);
    return openWorkspaceWithDefaults(rootPath, options);
  }
}
