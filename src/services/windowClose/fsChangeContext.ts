/**
 * What the FS-change handlers need from the outside world.
 *
 * Purpose: the injected-collaborator contract for
 * `fsChangeHandlers.ts` — store mutators, disk reads and pending-save guards,
 * supplied by `useExternalFileChanges` and faked wholesale in tests. Keeping the
 * handlers free of direct store / Tauri imports is what makes each branch
 * testable without rendering the hook.
 *
 * Its own module because `fsChangeHandlers.ts` reached the 300-line limit, and
 * this is the seam that costs nothing to cross: a contract has no control flow,
 * so nothing here can drift from the handlers except by a type error.
 *
 * @coordinates-with services/windowClose/fsChangeHandlers.ts — the sole consumer
 * @coordinates-with hooks/useExternalFileChanges.ts — builds the context
 * @module services/windowClose/fsChangeContext
 */

/**
 * Injected collaborators for the FS-change handlers. Mirrors exactly the
 * closures the hook already had — the handlers stay free of direct store /
 * Tauri imports so tests can pass fakes.
 */
export interface FsChangeContext {
  /** Read a file from disk; rejects if the file is gone/unreadable. */
  readTextFile: (path: string) => Promise<string>;
  /** Existence probe that never loads content — used for binary media tabs. */
  fileExists: (path: string) => Promise<boolean>;
  /** Normalize a path for map lookups and comparisons. */
  normalizePath: (path: string) => string;
  /** True if a save we initiated is still in flight for this normalized path. */
  hasPendingSave: (normalizedPath: string) => boolean;
  /** True if disk content matches a save we initiated (our own echo). */
  matchesPendingSave: (path: string, diskContent: string) => boolean;
  /** True if the tab is a binary media tab (png/mp4/…) — never UTF-8-read it. */
  /**
   * True when a path is binary media (image/audio/video). Extension-based and
   * association-independent — a media file must never be read as UTF-8 even if
   * its tab's formatId was routed elsewhere by a user format association.
   */
  isMedia: (path: string) => boolean;
  /** Re-point a tab + its document at the renamed path and clear missing state. */
  applyRename: (tabId: string, newPath: string) => void;
  /** Apply modify-style policy (reload / prompt / no-op) for a changed file. */
  handleModifyEvent: (tabId: string, changedPath: string, diskContent: string) => Promise<void>;
  /** Mark a tab's document missing (file truly gone). */
  handleDeletion: (tabId: string) => void;
  /** True if the tab's document is currently flagged missing. */
  isMissing: (tabId: string) => boolean;
  /** Clear a tab's missing flag (e.g. a media file reappeared on disk). */
  clearMissing: (tabId: string) => void;
  /**
   * Announce that a BINARY document's bytes changed on disk, so its viewer
   * re-fetches them. Text documents never use this — they carry their content
   * in the store and go through {@link FsChangeContext.handleModifyEvent}.
   */
  markBinaryFileChanged: (tabId: string) => void;
}
