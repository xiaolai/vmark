/**
 * Open Workspace With Config
 *
 * Purpose: Opens a workspace by reading its config from disk (if available)
 *   and updating the workspace store — returns the config for callers
 *   that need to restore tabs or apply settings.
 *
 * @coordinates-with workspaceStore.ts — openWorkspace action
 * @coordinates-with utils/macQuarantineNotice.ts — clears quarantine on macOS
 * @module hooks/openWorkspaceWithConfig
 */

import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { workspaceError } from "@/utils/debug";
import { maybeStripMacQuarantine } from "@/services/macos/macQuarantineNotice";
import {
  openOrActivateWorkspaceInstance,
  type OpenWorkspaceInstanceOptions,
} from "@/services/workspaces/workspaceInstanceActions";

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Runtime shape guard for the `read_workspace_config` IPC payload (T1/ADR-2).
 * The Rust side is the sole producer and serde-validates it, but this is a
 * highest-blast-radius boundary (drives tab restore + file-explorer filtering),
 * so the frontend re-checks the core fields before trusting the typed result.
 *
 * Mirrors what the Rust `WorkspaceConfig` struct actually serializes
 * (`workspace.rs`): `version` (number), `excludeFolders`/`lastOpenTabs`
 * (string arrays), `showHiddenFiles` (bool). `showAllFiles` is a frontend-only
 * field the store defaults — Rust never emits it, so it is NOT required here.
 * `version` is checked as a number (not literal `1`) so a future migration
 * bump doesn't make this guard reject otherwise-valid configs. Optional
 * `ai`/`identity` are intentionally not validated.
 *
 * Exported for testing.
 */
export function isValidWorkspaceConfig(raw: unknown): raw is WorkspaceConfig {
  if (typeof raw !== "object" || raw === null) return false;
  const c = raw as Record<string, unknown>;
  return (
    typeof c.version === "number" &&
    isStringArray(c.excludeFolders) &&
    isStringArray(c.lastOpenTabs) &&
    typeof c.showHiddenFiles === "boolean"
  );
}

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
  openOrActivateWorkspaceInstance(rootPath, options);
  return null;
}

/** Reads workspace config from disk and opens the workspace in the store; returns the config or null on failure. */
export async function openWorkspaceWithConfig(
  rootPath: string,
  options: OpenWorkspaceInstanceOptions = {},
): Promise<WorkspaceConfig | null> {
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
    openOrActivateWorkspaceInstance(rootPath, options);
    return config;
  } catch (error) {
    workspaceError("Failed to load config:", error);
    return openWorkspaceWithDefaults(rootPath, options);
  }
}
