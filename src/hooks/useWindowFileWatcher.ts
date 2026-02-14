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
 *
 * @coordinates-with useExternalFileChanges.ts — handles the change events
 * @module hooks/useWindowFileWatcher
 */

import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getDirectory } from "@/utils/pathUtils";
export function useWindowFileWatcher(): void {
  const windowLabel = useWindowLabel();
  const isWorkspaceMode = useWorkspaceStore((state) => state.isWorkspaceMode);
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const activeTabId = useTabStore(
    (state) => state.activeTabId[windowLabel] ?? null
  );
  const activeFilePath = useDocumentStore((state) =>
    activeTabId ? state.documents[activeTabId]?.filePath ?? null : null
  );

  const watchPath = useMemo(() => {
    if (isWorkspaceMode && rootPath) return rootPath;
    if (activeFilePath) {
      const dir = getDirectory(activeFilePath);
      if (dir && !/^[A-Za-z]:$/.test(dir)) {
        return dir;
      }
    }
    return null;
  }, [isWorkspaceMode, rootPath, activeFilePath]);

  useEffect(() => {
    if (!watchPath) {
      invoke("stop_watching", { watchId: windowLabel }).catch((err) => {
        console.warn("[Watcher] Failed to stop watcher:", err);
      });
      return;
    }

    invoke("start_watching", { watchId: windowLabel, path: watchPath }).catch(
      (err) => {
        console.warn("[Watcher] Failed to start watcher:", err);
      }
    );

    return () => {
      invoke("stop_watching", { watchId: windowLabel }).catch((err) => {
        console.warn("[Watcher] Failed to stop watcher on cleanup:", err);
      });
    };
  }, [windowLabel, watchPath]);
}
