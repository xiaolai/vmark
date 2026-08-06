import { useEffect, useRef } from "react";
// Global listen() is correct here — Rust emits app:open-file via app.emit() (global
// broadcast), and only global listen() is guaranteed to receive global events.
// See: https://v2.tauri.app/develop/calling-frontend
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getReplaceableTab, findExistingTabForPath } from "@/services/tabs/replaceableTab";
import { resolveFinderOpenBranch } from "@/services/navigation/finderOpenBranch";
import { loadFileIntoTab } from "@/services/navigation/loadFileIntoTab";
import {
  activateExistingTab,
  createNewTabForFile,
  replaceTabWithFile,
  withSizeGateAndIndicator,
  type FinderBranchContext,
} from "@/services/navigation/finderOpenBranches";
import { waitForRestoreComplete, RESTORE_WAIT_TIMEOUT_MS } from "@/services/persistence/hotExit/hotExitCoordination";
import { finderFileOpenWarn, finderFileOpenError } from "@/utils/debug";
import { routeOpenBySize } from "@/services/navigation/largeFileRouting";
import { errorMessage } from "@/utils/errorMessage";

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
     * Toast a localized "failed to open file" error — used by every
     * read-failure branch so users always see the cause instead of an
     * empty tab or a silent no-op.
     */
    const toastOpenFailure = (error: unknown) => {
      const msg = errorMessage(error);
      // Pin: error message embeds a system error the user may want to read.
      toast.error(i18n.t("dialog:toast.failedToOpenFile", { error: msg }), {
        pin: true,
      });
    };

    const branchCtx: FinderBranchContext = {
      windowLabel,
      isCancelled: () => cancelled,
      onOpenFailure: toastOpenFailure,
      loadFileIntoTab,
    };

    /**
     * Branch 4 — different workspace, so open in a new window. The Rust
     * command validates the path and extends the fs scope for the spawned
     * window; it stays here because it touches no tab in THIS window.
     */
    const openFileInNewWindow = async (
      path: string,
      workspaceRoot: string | null,
    ) => {
      try {
        if (workspaceRoot) {
          await invoke("open_workspace_in_new_window", { workspaceRoot, filePath: path });
        } else {
          await invoke("open_file_in_new_window", { path });
        }
      } catch (error) {
        finderFileOpenError("Failed to open in new window:", path, error);
        toastOpenFailure(error);
      }
    };

    /**
     * Dispatch a file open request to the correct branch. Must be called
     * via enqueueFileOpen() to ensure serialization. Branch SELECTION is the
     * pure resolveFinderOpenBranch(); this function owns only the async
     * size-gate, indicator lifecycle, and branch EXECUTION.
     */
    const processFileOpen = async (path: string, workspaceRoot: string | null) => {
      // Pre-read size check: applies to every non-activate branch below.
      // Refused files never create a tab or open a window; huge files confirm.
      // (Existing-tab activation skips the read, so resolve the branch first.)
      const branch = resolveFinderOpenBranch({
        filePath: path,
        existingTabId: findExistingTabForPath(windowLabel, path),
        replaceableTabId: getReplaceableTab(windowLabel)?.tabId ?? null,
        workspaceRailMode: useSettingsStore.getState().general.workspaceRailMode,
        currentRoot: useWorkspaceStore.getState().rootPath,
        incomingWorkspace: workspaceRoot,
      });

      if (branch.kind === "activate") {
        activateExistingTab(branchCtx, branch.tabId);
        return;
      }

      switch (branch.kind) {
        case "replace": {
          await withSizeGateAndIndicator(branchCtx, path, async () => {
            // Re-check: the replaceable tab could have been claimed during the
            // awaited size route. Fall back to a new tab if it is gone.
            const tab = getReplaceableTab(windowLabel);
            if (!tab) {
              return createNewTabForFile(
                branchCtx,
                path,
                workspaceRoot,
                !useWorkspaceStore.getState().rootPath,
              );
            }
            return replaceTabWithFile(branchCtx, tab, path, workspaceRoot);
          });
          return;
        }
        case "create": {
          await withSizeGateAndIndicator(branchCtx, path, () =>
            createNewTabForFile(branchCtx, path, workspaceRoot, branch.adoptWorkspace),
          );
          return;
        }
        case "newWindow": {
          // The remote window runs its own size route when its cold-start queue
          // drains, so no tab is marked here — none exists in this window.
          const route = await routeOpenBySize(path);
          if (!route.proceed || cancelled) return;
          await openFileInNewWindow(path, workspaceRoot);
          return;
        }
      }
    };

    /** Enqueue a file open, serialized to prevent concurrent tab races */
    const enqueueFileOpen = (path: string, workspaceRoot: string | null) => {
      processingChainRef.current = processingChainRef.current
        .then(() => processFileOpen(path, workspaceRoot))
        .catch((error) => {
          finderFileOpenError("Failed to open file:", path, error);
        });
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
        const listener = await listen<OpenFilePayload>("app:open-file", handleOpenFile);
        // The hook can unmount while listen() is in flight; the cleanup ran with
        // unlisten still null. Detach immediately so no live listener survives
        // the unmount.
        if (cancelled) {
          listener();
          return;
        }
        unlisten = listener;

        // CRITICAL: Wait for hot exit restore to complete before processing pending files
        const restoreCompleted = await waitForRestoreComplete(RESTORE_WAIT_TIMEOUT_MS);
        if (!restoreCompleted) {
          finderFileOpenWarn("Hot exit restore timed out, proceeding anyway");
        }

        // Drain queued events, then flip the flag. Events can arrive WHILE we
        // drain (handleOpenFile still queues until restoreCompleteRef is true),
        // so loop until the queue is empty — otherwise that second wave would
        // sit in pendingEventsRef forever and never open. Order is preserved
        // because enqueueFileOpen serializes through processingChainRef.
        while (pendingEventsRef.current.length > 0) {
          if (cancelled) return;
          const queued = pendingEventsRef.current;
          pendingEventsRef.current = [];
          for (const payload of queued) {
            if (cancelled) return;
            enqueueFileOpen(payload.path, payload.workspace_root);
          }
        }

        // Mark restore as complete so future events are processed immediately
        restoreCompleteRef.current = true;

        // Fetch and process any files queued during cold start.
        // This handles the race condition where Finder opens a file before React mounts.
        /* v8 ignore start -- pendingFetchedRef already-fetched guard not exercised in tests */
        if (!pendingFetchedRef.current) {
          // Flip only AFTER the invoke resolves. Setting it first meant a
          // rejected fetch left the flag true, so the cold-start queue was
          // never retried for the life of this mount and files opened from
          // Finder before React mounted simply never appeared.
          const pending = await invoke<PendingFileOpen[]>("get_pending_file_opens");
          pendingFetchedRef.current = true;
          for (const file of pending) {
            if (cancelled) return;
            enqueueFileOpen(file.path, file.workspace_root);
          }
        }
        /* v8 ignore stop */
      } catch (error) {
        finderFileOpenError("Init failed:", error);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [windowLabel]);
}
