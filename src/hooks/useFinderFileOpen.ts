/**
 * Finder File Open Hook
 *
 * Purpose: Handles files opened from macOS Finder (double-click, "Open With",
 *   drag to dock icon) — routes to existing tab, new tab, or new window.
 *
 * Pipeline: Finder → macOS open event → Rust queues → emits `app:open-file` →
 *   this hook → resolveOpenAction() → load in current tab / new tab / new window
 *
 * Key decisions:
 *   - Waits for hot exit restore before processing (prevents race condition)
 *   - Cold-start files queued in Rust, drained after React mounts
 *   - Empty untitled tab gets reused (replaced, not creating a new one)
 *   - Files within workspace open as tabs; outside opens new window
 *
 * @edge-case Cold start: files opened before React mounts are queued in Rust
 * @edge-case Hot exit: waits for restore to complete to avoid tab overwrite
 * @coordinates-with openPolicy.ts — resolveOpenAction for routing decision
 * @module hooks/useFinderFileOpen
 */
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { getReplaceableTab, findExistingTabForPath } from "@/hooks/useReplaceableTab";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { isWithinRoot } from "@/utils/paths";
import { waitForRestoreComplete } from "@/utils/hotExit/hotExitCoordination";

interface OpenFilePayload {
  path: string;
  workspace_root: string | null;
}

/** Payload from Rust's pending file queue (uses snake_case) */
interface PendingFileOpen {
  path: string;
  workspace_root: string | null;
}

/**
 * Load file content into a tab (new or existing).
 * Returns true on success, false on failure.
 */
/**
 * Load file content into a tab (new or existing).
 * Throws on read failure so callers can handle cleanup.
 */
async function loadFileIntoTab(
  tabId: string,
  path: string,
  isNewTab: boolean,
): Promise<void> {
  const content = await readTextFile(path);
  const meta = detectLinebreaks(content);
  if (isNewTab) {
    useDocumentStore.getState().initDocument(tabId, content, path);
  } else {
    useDocumentStore.getState().loadContent(tabId, content, path, meta);
  }
  useDocumentStore.getState().setLineMetadata(tabId, meta);
  useRecentFilesStore.getState().addFile(path);
}

/**
 * Hook to handle files opened from Finder.
 *
 * When the user opens a markdown file from Finder (double-click or "Open With"),
 * and the app is already running, this hook receives the file path and:
 * 1. Checks if there's an existing tab for this file -> activates it
 * 2. Checks if there's an empty (replaceable) tab -> loads file there
 * 3. If same workspace -> creates new tab in the current window
 * 4. Otherwise -> opens file in a new window (different workspace)
 *
 * Also fetches any pending files queued during cold start.
 */
export function useFinderFileOpen(): void {
  const windowLabel = useWindowLabel();
  // Guard against StrictMode double-execution
  const pendingFetchedRef = useRef(false);
  // Track whether hot exit restore has completed
  const restoreCompleteRef = useRef(false);
  // Queue events that arrive before restore completes
  const pendingEventsRef = useRef<OpenFilePayload[]>([]);
  // Serialize all processFileOpen calls to prevent concurrent tab races
  const processingChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    // Only the main window handles Finder file opens initially
    // (Rust emits to main window specifically)
    if (windowLabel !== "main") {
      return;
    }

    /**
     * Process a file open request (from event or pending queue).
     * Must be called via enqueueFileOpen() to ensure serialization.
     */
    const processFileOpen = async (path: string, workspaceRoot: string | null) => {
      // Check if file is already open in a tab
      const existingTabId = findExistingTabForPath(windowLabel, path);
      if (existingTabId) {
        useTabStore.getState().setActiveTab(windowLabel, existingTabId);
        return;
      }

      // Check if there's a replaceable (empty) tab
      const replaceableTab = getReplaceableTab(windowLabel);

      if (replaceableTab) {
        // Load file into the empty tab
        if (workspaceRoot) {
          await openWorkspaceWithConfig(workspaceRoot);
        }
        try {
          await loadFileIntoTab(replaceableTab.tabId, path, false);
          useTabStore.getState().updateTabPath(replaceableTab.tabId, path);
        } catch (error) {
          console.error("[FinderFileOpen] Failed to load file:", path, error);
        }
        return;
      }

      // No replaceable tab — decide: new tab in same window vs new window
      const { rootPath } = useWorkspaceStore.getState();
      const fileInCurrentWorkspace = rootPath ? isWithinRoot(rootPath, path) : false;
      // Same window when: file is in current workspace, OR both have no workspace,
      // OR current window has no workspace and file brings one (adopt it).
      const sameWorkspace = workspaceRoot
        ? rootPath === workspaceRoot || fileInCurrentWorkspace || !rootPath
        : fileInCurrentWorkspace || !rootPath;

      if (sameWorkspace) {
        // Same workspace (or no workspace at all) — create new tab here
        if (workspaceRoot && !rootPath) {
          await openWorkspaceWithConfig(workspaceRoot);
        }
        const tabId = useTabStore.getState().createTab(windowLabel, path);
        try {
          await loadFileIntoTab(tabId, path, true);
        } catch (error) {
          console.error("[FinderFileOpen] Failed to load file:", path, error);
          useDocumentStore.getState().initDocument(tabId, "", null);
        }
      } else {
        // Different workspace — open in new window
        try {
          if (workspaceRoot) {
            await invoke("open_workspace_in_new_window", {
              workspaceRoot,
              filePath: path,
            });
          } else {
            await invoke("open_file_in_new_window", { path });
          }
        } catch (error) {
          console.error("[FinderFileOpen] Failed to open in new window:", path, error);
        }
      }
    };

    /** Enqueue a file open, serialized to prevent concurrent tab races */
    const enqueueFileOpen = (path: string, workspaceRoot: string | null) => {
      processingChainRef.current = processingChainRef.current.then(() =>
        processFileOpen(path, workspaceRoot),
      );
    };

    /**
     * Handle incoming open-file events.
     * If restore hasn't completed, queue the event to avoid race conditions
     * where content could be loaded then cleared by hot exit restore.
     */
    const handleOpenFile = (event: { payload: OpenFilePayload }) => {
      if (!restoreCompleteRef.current) {
        pendingEventsRef.current.push(event.payload);
        return;
      }
      enqueueFileOpen(event.payload.path, event.payload.workspace_root);
    };

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    /**
     * IMPORTANT ORDERING:
     * 1. Register the event listener FIRST
     * 2. Wait for hot exit restore to complete (prevents race condition)
     * 3. Process any queued events (arrived during restore)
     * 4. Then call get_pending_file_opens (which flips Rust's FRONTEND_READY flag)
     *
     * Events that arrive before restore completes are queued and processed
     * after restore finishes, preventing content from being overwritten.
     */
    (async () => {
      try {
        unlisten = await listen<OpenFilePayload>("app:open-file", handleOpenFile);

        // CRITICAL: Wait for hot exit restore to complete before processing pending files
        const restoreCompleted = await waitForRestoreComplete(15000);
        if (!restoreCompleted) {
          console.warn("[FinderFileOpen] Hot exit restore timed out, proceeding anyway");
        }

        // Drain queued events BEFORE marking restore complete to preserve order.
        // New events arriving now are still queued until we flip the flag.
        const queued = pendingEventsRef.current;
        pendingEventsRef.current = [];
        for (const payload of queued) {
          if (cancelled) return;
          enqueueFileOpen(payload.path, payload.workspace_root);
        }

        // Mark restore as complete so future events are processed immediately
        restoreCompleteRef.current = true;

        // Fetch and process any files queued during cold start.
        // This handles the race condition where Finder opens a file before React mounts.
        if (!pendingFetchedRef.current) {
          pendingFetchedRef.current = true;
          const pending = await invoke<PendingFileOpen[]>("get_pending_file_opens");
          for (const file of pending) {
            if (cancelled) return;
            enqueueFileOpen(file.path, file.workspace_root);
          }
        }
      } catch (error) {
        console.error("[FinderFileOpen] Init failed:", error);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [windowLabel]);
}
