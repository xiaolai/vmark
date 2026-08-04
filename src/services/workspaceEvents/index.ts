/**
 * Workspace event layer — public surface.
 *
 * The frontend normalization layer between the Rust `fs:changed` watcher and
 * its consumers: it owns the *event* (reliable, deduped, self-write-flagged,
 * coalesced, no-op-suppressed) and never the reaction. Wired per window by
 * services/workspaceEvents/subscribeWorkspaceEvents. Internal helpers (normalizeFsEvents, the dep
 * types) are imported directly from their files where needed.
 *
 * @module services/workspaceEvents
 */

export {
  attachFsSource,
  createWorkspaceEventBus,
  type WorkspaceEventBus,
  type WorkspaceEventListener,
} from "./workspaceEventBus";
export { createContentHashCache, hashContent } from "./contentHashCache";
export { suppressUnchanged } from "./suppressUnchanged";
export type { SemanticWorkspaceEvent } from "./types";
