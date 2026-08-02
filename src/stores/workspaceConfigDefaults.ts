/**
 * Workspace config shape, defaults, and the auto-created-config repair.
 *
 * Purpose: one normalizer every entry point runs, so a config reaching live
 * state always has defaults filled in, an identity present (trust gating reads
 * it), and no array aliased with the module defaults or the caller.
 *
 * Key decisions:
 *   - Extracted from workspaceStore.ts so the store file holds state only.
 *   - `excludeFolders: []` from an app-minted config is repaired, not honored.
 *     See repairAutoCreatedExcludeFolders for why that is safe.
 *
 * @coordinates-with workspaceStore.ts — runs this on openWorkspace/bootstrapConfig
 * @coordinates-with services/workspaces/workspaceSession.ts — repairs the on-disk config it rewrites
 * @module stores/workspaceConfigDefaults
 */
import { createWorkspaceIdentity, type WorkspaceIdentity } from "@/utils/workspaceIdentity";
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

export const DEFAULT_EXCLUDED_FOLDERS = [".git", "node_modules"];

/**
 * Restore the default excludes on a config the APP minted without any (#1187).
 *
 * v0.9.21–v0.9.23 let workspaceSession mint a brand-new workspace's config with
 * an empty `excludeFolders`, and nothing healed it afterwards: the store's
 * `?? DEFAULT_EXCLUDED_FOLDERS` only fires when the field is nullish, and `[]`
 * is not. The file explorer then walked `node_modules` and `.git` on every load
 * and every fs event — 4055 directories instead of 65 in the workspace that
 * surfaced this — leaving the tree stale or empty, so folders would not expand
 * and files would not open.
 *
 * A user who deliberately clears the list is left alone: every user-initiated
 * write goes through the store, which mints an identity into each config it
 * normalizes, so "empty AND identity-less" matches only the app-minted shape.
 * Repairing is idempotent — the result is non-empty and no longer a candidate.
 */
export function repairAutoCreatedExcludeFolders(config: WorkspaceConfig): WorkspaceConfig {
  const wasAutoCreated = config.identity === undefined && config.excludeFolders.length === 0;
  if (!wasAutoCreated) return config;
  return { ...config, excludeFolders: [...DEFAULT_EXCLUDED_FOLDERS] };
}

/**
 * Bring any config (from disk, from a caller, or none at all) to the shape the
 * store guarantees: defaults filled in, an identity present, and no array
 * shared with the module defaults or the caller — live state that aliases
 * `DEFAULT_EXCLUDED_FOLDERS` would let one in-place mutation corrupt every
 * future workspace.
 *
 * Both entry points (openWorkspace, bootstrapConfig) run this, so a
 * bootstrapped workspace can't end up without the identity an opened one
 * always gets.
 */
export function normalizeWorkspaceConfig(config?: WorkspaceConfig | null): WorkspaceConfig {
  const source: Partial<WorkspaceConfig> = config ?? {};
  const merged: WorkspaceConfig = {
    version: 1,
    showHiddenFiles: false,
    showAllFiles: false,
    ...source,
    excludeFolders: [...(source.excludeFolders ?? DEFAULT_EXCLUDED_FOLDERS)],
    lastOpenTabs: [...(source.lastOpenTabs ?? [])],
  };
  // Repair BEFORE minting the identity below — that mint would otherwise mask
  // the very absence that identifies an app-created config.
  const repaired = repairAutoCreatedExcludeFolders(merged);
  return { ...repaired, identity: repaired.identity ?? createWorkspaceIdentity() };
}
