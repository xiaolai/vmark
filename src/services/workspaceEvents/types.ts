/**
 * Workspace event layer — shared vocabulary.
 *
 * Purpose: The canonical, deduplicated event types the workspace event layer
 *   emits, unifying the ad-hoc `FsChangeEvent` shapes previously re-declared per
 *   consumer (useFileTree, useExternalFileChanges). This layer owns the *event*;
 *   deciding what a change *means* (staleness, recompile) and what to *do* about
 *   it belongs to consumers — never here.
 *
 * @module services/workspaceEvents/types
 */

/**
 * The raw `fs:changed` payload emitted by the Rust `notify` watcher. `kind` is
 * the watcher's string ("create" | "modify" | "remove" | "rename"); `paths` are
 * absolute, and for a `rename` arrive as flattened [old, new] pairs.
 */
export interface RawFsChangeEvent {
  /** Watcher id — the emitting window's label. */
  watchId: string;
  /** The directory the watcher covers. */
  rootPath: string;
  /** Changed absolute paths (rename → flattened [old, new] pairs). */
  paths: string[];
  /** Watcher kind string. */
  kind: string;
}

/** Semantic classification of a workspace file change. */
export type WorkspaceEventKind = "created" | "modified" | "deleted" | "renamed";

/**
 * One normalized, in-scope workspace change — the layer's output unit.
 */
export interface SemanticWorkspaceEvent {
  /** What happened to the path. */
  kind: WorkspaceEventKind;
  /** Normalized absolute path of the affected file. */
  path: string;
  /**
   * For `renamed`, the normalized old path. Absent for other kinds and for an
   * unpaired rename (an atomic-write rename that only reported its target).
   */
  previousPath?: string;
  /** The (normalized) workspace root the event was scoped against. */
  rootPath: string;
  /**
   * True when this change is the echo of a save VMark itself initiated — a
   * pending save is registered for the path. Consumers skip self-writes for
   * reload/notify purposes.
   */
  selfWrite: boolean;
}
