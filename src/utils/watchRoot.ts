/**
 * Watch-root resolution — the single directory the fs watcher covers.
 *
 * Purpose: One pure decision shared by the watcher lifecycle
 *   (useWindowFileWatcher, which starts `start_watching` on this path) and the
 *   workspace event source (useWorkspaceEventBus, which scopes normalized events
 *   to it). Keeping both on this one function guarantees the *watched* root and
 *   the *scoped* root never drift — a drift would silently drop (or leak) events.
 *
 * Rule: workspace mode watches the workspace root; otherwise the active
 *   document's parent directory (so a singly-opened file is still watched). A
 *   bare Windows drive root (`C:`) is rejected as too broad.
 *
 * @coordinates-with hooks/useWindowFileWatcher — starts the Rust watcher on this path
 * @coordinates-with services/workspaceEvents/subscribeWorkspaceEvents — scopes normalized events to this path
 * @module utils/watchRoot
 */

import { getDirectory } from "@/utils/pathUtils";

/** Inputs for {@link pickWatchRoot} — the reactive/imperative caller supplies live values. */
export interface WatchRootInputs {
  isWorkspaceMode: boolean;
  workspaceRoot: string | null;
  activeFilePath: string | null;
}

/** Resolve the directory to watch (and scope events to), or `null` when nothing is open. */
export function pickWatchRoot({
  isWorkspaceMode,
  workspaceRoot,
  activeFilePath,
}: WatchRootInputs): string | null {
  if (isWorkspaceMode && workspaceRoot) return workspaceRoot;
  if (activeFilePath) {
    // getDirectory normalizes a bare drive root (`C:` → `C:\`) itself and
    // returns "" for a bare filename, so the directory is watch-safe as-is.
    const dir = getDirectory(activeFilePath);
    if (dir) return dir;
  }
  return null;
}
