/**
 * Window File Watcher Hook
 *
 * Purpose: Starts and stops a Rust filesystem watcher for the current window —
 *   watches the workspace root or active document's directory for external changes.
 *
 * Pipeline: This hook determines watchPath → invoke("start_watching") →
 *   Rust debounced watcher emits file:changed/file:deleted events →
 *   useExternalFileChanges handles them
 *
 * Key decisions:
 *   - Workspace mode: watches workspace root
 *   - Non-workspace: watches active document's parent directory
 *   - Stops watcher on unmount or when watchPath changes
 *   - Memoized watchPath to avoid unnecessary watcher restarts
 *   - Watcher start/stop calls are SERIALIZED per windowLabel: the Rust side
 *     keys watchers by watchId (= windowLabel), so a stale cleanup's async
 *     `stop_watching` could otherwise resolve AFTER the next effect's
 *     `start_watching` and silently tear down the fresh watcher. Running them
 *     through an ordered per-window queue preserves effect order (stop → start)
 *     regardless of individual invoke resolution timing.
 *
 * @coordinates-with useExternalFileChanges.ts — handles the change events
 * @module hooks/useWindowFileWatcher
 */

import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useActiveWorkspaceScope } from "@/hooks/useActiveWorkspaceScope";
import { getDirectory } from "@/utils/pathUtils";
import { watcherWarn } from "@/utils/debug";

/**
 * Per-window serialization queue. Each watcher op chains onto the previous one
 * for the same windowLabel so start/stop always execute in enqueue order —
 * preventing a late `stop_watching` from undoing a newer `start_watching`.
 *
 * Exported for testing (reset between cases).
 */
export const watcherQueues = new Map<string, Promise<void>>();

/** Enqueue a watcher operation for a window, preserving registration order. */
export function enqueueWatcherOp(
  windowLabel: string,
  op: () => Promise<unknown>,
): void {
  const prev = watcherQueues.get(windowLabel) ?? Promise.resolve();
  // Swallow both the predecessor's and this op's rejection so the chain never
  // surfaces an unhandled rejection and a failed op cannot break ordering for
  // the ops queued behind it. (Production ops already .catch() internally; this
  // is defense in depth.)
  const next = prev
    .catch(() => {})
    .then(() => op())
    .then(
      () => {},
      () => {},
    );
  watcherQueues.set(windowLabel, next);
  // Drop the queue entry once it settles and nothing newer replaced it, so the
  // map doesn't retain a resolved promise forever for closed windows.
  void next.finally(() => {
    if (watcherQueues.get(windowLabel) === next) {
      watcherQueues.delete(windowLabel);
    }
  });
}

function startWatching(windowLabel: string, path: string): void {
  enqueueWatcherOp(windowLabel, () =>
    invoke("start_watching", { watchId: windowLabel, path }).catch((err) => {
      watcherWarn("Failed to start watcher:", err);
    }),
  );
}

function stopWatching(windowLabel: string, reason: string): void {
  enqueueWatcherOp(windowLabel, () =>
    invoke("stop_watching", { watchId: windowLabel }).catch((err) => {
      watcherWarn(reason, err);
    }),
  );
}

/** Hook that starts/stops a Rust filesystem watcher for the workspace root or active document's directory. */
export function useWindowFileWatcher(): void {
  const windowLabel = useWindowLabel();
  const workspaceScope = useActiveWorkspaceScope(windowLabel);
  const activeTabId = useTabStore(
    (state) => state.activeTabId[windowLabel] ?? null
  );
  const activeFilePath = useDocumentStore((state) =>
    activeTabId ? state.documents[activeTabId]?.filePath ?? null : null
  );

  const watchPath = useMemo(() => {
    if (workspaceScope.isWorkspaceMode && workspaceScope.rootPath) {
      return workspaceScope.rootPath;
    }
    if (activeFilePath) {
      const dir = getDirectory(activeFilePath);
      if (dir && !/^[A-Za-z]:$/.test(dir)) {
        return dir;
      }
    }
    return null;
  }, [workspaceScope.isWorkspaceMode, workspaceScope.rootPath, activeFilePath]);

  useEffect(() => {
    if (!watchPath) {
      stopWatching(windowLabel, "Failed to stop watcher:");
      return;
    }

    startWatching(windowLabel, watchPath);

    return () => {
      stopWatching(windowLabel, "Failed to stop watcher on cleanup:");
    };
  }, [windowLabel, watchPath]);
}
