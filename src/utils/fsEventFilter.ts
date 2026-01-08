/**
 * File System Event Filtering
 *
 * Pure helpers for deciding whether to refresh the file tree
 * based on watcher events. Used to scope refreshes to the correct window.
 */

/**
 * Input event from the watcher.
 * Matches the FsChangeEvent from Rust.
 */
export interface FsEventInput {
  /** Unique identifier for this watcher (window label) */
  watchId: string;
  /** Root path being watched */
  rootPath: string;
  /** Changed paths */
  paths: string[];
  /** Event kind */
  kind: string;
}

/**
 * Determine if the file tree should be refreshed based on a watcher event.
 *
 * Criteria:
 * 1. Event must be from the same watcher (watchId matches)
 * 2. At least one changed path must be within the tree's root path
 *
 * @param event - The file system change event
 * @param activeWatchId - The watchId this tree is listening to
 * @param treeRootPath - The root path of this file tree
 * @returns true if the tree should refresh
 */
export function shouldRefreshTree(
  event: FsEventInput,
  activeWatchId: string,
  treeRootPath: string | null
): boolean {
  // Can't refresh if no root path
  if (!treeRootPath) {
    return false;
  }

  // Event must be from our watcher
  if (event.watchId !== activeWatchId) {
    return false;
  }

  // Need at least one path to have changed
  if (event.paths.length === 0) {
    return false;
  }

  // Check if any changed path is within our tree's root
  // Use boundary check to avoid false positives (e.g., /root matching /rootother)
  return event.paths.some(
    (path) => path === treeRootPath || path.startsWith(treeRootPath + "/")
  );
}
