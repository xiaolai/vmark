import { useEffect, useRef } from "react";
// Global listen() is correct here — Rust emits app:open-file via app.emit() (global
// broadcast), and only global listen() is guaranteed to receive global events.
// See: https://v2.tauri.app/develop/calling-frontend
import { listen } from "@tauri-apps/api/event";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useWindowLabel } from "@/contexts/WindowContext";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { getReplaceableTab, findExistingTabForPath } from "@/hooks/useReplaceableTab";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import type { ReplaceableTabInfo } from "@/utils/openPolicy";
import { getFileName } from "@/utils/pathUtils";
import { resolveFinderOpenBranch } from "@/hooks/finderOpenBranch";
import { waitForRestoreComplete, RESTORE_WAIT_TIMEOUT_MS } from "@/services/persistence/hotExit/hotExitCoordination";
import { finderFileOpenWarn, finderFileOpenError } from "@/utils/debug";
import { routeOpenBySize } from "@/services/navigation/largeFileRouting";
import { useFileLoadStore } from "@/stores/documentStore";
import { maybeMarkLargeMarkdownAsSource } from "@/lib/formats/markdownLargeFile";
import { shouldShowProgressIndicator } from "@/utils/fileSizeThresholds";
import { errorMessage } from "@/utils/errorMessage";
import { applyFileOwnershipAfterOpen } from "@/services/workspaces/fileOwnership";

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
 * Throws on read failure so callers can handle cleanup.
 */
export async function loadFileIntoTab(
  tabId: string,
  path: string,
  isNewTab: boolean,
): Promise<void> {
  const content = await readTextFile(path);
  const meta = detectLinebreaks(content);
  // WI-1B.6 / WI-2.6 — registry-driven mode dispatch. .yaml / .yml
  // route to the YAML adapter (kind: "split-pane"), so no
  // force-source is needed.
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

    /**
     * Branch 1 — file already has a tab. Activate it and stop.
     */
    const activateExistingTab = (tabId: string) => {
      useTabStore.getState().setActiveTab(windowLabel, tabId);
    };

    /**
     * Branch 2 — single clean untitled tab exists. Load into it; on read
     * failure, surface the error and leave the tab untouched (the user
     * gets their blank untitled tab back).
     */
    const replaceTabWithFile = async (
      tab: ReplaceableTabInfo,
      path: string,
      workspaceRoot: string | null,
    ) => {
      if (workspaceRoot) {
        await openWorkspaceWithConfig(workspaceRoot, { windowLabel });
      }
      try {
        await loadFileIntoTab(tab.tabId, path, false);
        if (cancelled) return;
        useTabStore.getState().updateTabPath(tab.tabId, path);
        applyFileOwnershipAfterOpen(tab.tabId, path);
      } catch (error) {
        finderFileOpenError("Failed to load file:", path, error);
        toastOpenFailure(error);
        return;
      }
      if (cancelled) return;
      // Explicitly activate — the replaceable tab is likely already active
      // (it's the only tab), but concurrent crash-recovery tabs could have
      // stolen focus during the async loadFileIntoTab above.
      useTabStore.getState().setActiveTab(windowLabel, tab.tabId);
    };

    /**
     * Branch 3 — same workspace (or no workspace), so open as a new tab
     * in the current window. On read failure, detach the orphan tab so
     * the user isn't left staring at an empty document with no filePath.
     * `adoptWorkspace` is true when the current window has no workspace
     * and the incoming file brings one we should adopt.
     */
    const createNewTabForFile = async (
      path: string,
      workspaceRoot: string | null,
      adoptWorkspace: boolean,
    ) => {
      if (adoptWorkspace && workspaceRoot) {
        await openWorkspaceWithConfig(workspaceRoot, { windowLabel });
      }
      if (cancelled) return;
      const tabId = useTabStore.getState().createTab(windowLabel, path);
      try {
        await loadFileIntoTab(tabId, path, true);
        applyFileOwnershipAfterOpen(tabId, path);
      } catch (error) {
        finderFileOpenError("Failed to load file:", path, error);
        // Use detachTab (not closeTab) to keep the "reopen closed tab"
        // history reserved for user-closed tabs only.
        useTabStore.getState().detachTab(windowLabel, tabId);
        toastOpenFailure(error);
        return;
      }
      if (cancelled) return;
      // Re-assert activation after async load — concurrent crash-recovery
      // tabs may have auto-activated during the await above.
      useTabStore.getState().setActiveTab(windowLabel, tabId);
    };

    /**
     * Branch 4 — different workspace, so open in a new window. The Rust
     * command is responsible for validating the path and extending the
     * fs scope for the spawned window.
     */
    const openFileInNewWindow = async (
      path: string,
      workspaceRoot: string | null,
    ) => {
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
        finderFileOpenError("Failed to open in new window:", path, error);
        toastOpenFailure(error);
      }
    };

    /**
     * Run a create/replace branch through the shared indicator lifecycle:
     * start the indicator, run the branch, then mark forced-source on the
     * resulting tab — or clear the indicator if the branch produced no new/
     * loaded tab (read failure). The `run` callback returns the tab id that
     * received content, or null on failure.
     */
    const withIndicator = async (
      route: Awaited<ReturnType<typeof routeOpenBySize>>,
      path: string,
      run: () => Promise<string | null>,
    ) => {
      const shouldShowIndicator =
        !route.forceSourceMode && shouldShowProgressIndicator(route.sizeBytes);
      let indicatorLoadId: number | null = null;
      if (shouldShowIndicator) {
        indicatorLoadId = useFileLoadStore
          .getState()
          .startLoad(getFileName(path) || path, route.sizeBytes);
      }
      const loadedTabId = await run();
      if (loadedTabId) {
        maybeMarkLargeMarkdownAsSource(loadedTabId, path, route.forceSourceMode);
      } else if (indicatorLoadId !== null) {
        // No content landed (read failure / detached orphan) — clear the
        // indicator so no stuck spinner lingers.
        useFileLoadStore.getState().endLoad(indicatorLoadId);
      }
    };

    /** Run a create-tab branch; return the new tab id or null if it failed. */
    const runCreateBranch = async (
      path: string,
      workspaceRoot: string | null,
      adoptWorkspace: boolean,
    ): Promise<string | null> => {
      const tabIdBefore = useTabStore.getState().getActiveTab(windowLabel)?.id ?? null;
      await createNewTabForFile(path, workspaceRoot, adoptWorkspace);
      const tabIdAfter = useTabStore.getState().getActiveTab(windowLabel)?.id ?? null;
      return tabIdAfter && tabIdAfter !== tabIdBefore ? tabIdAfter : null;
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
        activateExistingTab(branch.tabId);
        return;
      }

      const route = await routeOpenBySize(path);
      if (!route.proceed) return;

      switch (branch.kind) {
        case "replace": {
          const replaceableTab = getReplaceableTab(windowLabel);
          // Re-check: the replaceable tab could have been claimed during the
          // awaited size route. Fall back to a new tab if it's gone.
          if (!replaceableTab) {
            await withIndicator(route, path, () =>
              runCreateBranch(path, workspaceRoot, !useWorkspaceStore.getState().rootPath),
            );
            return;
          }
          await withIndicator(route, path, async () => {
            await replaceTabWithFile(replaceableTab, path, workspaceRoot);
            // replaceTabWithFile handles its own toast on failure; a missing
            // filePath afterwards means the read failed.
            return useDocumentStore.getState().documents[replaceableTab.tabId]?.filePath
              ? replaceableTab.tabId
              : null;
          });
          return;
        }
        case "create": {
          await withIndicator(route, path, () =>
            runCreateBranch(path, workspaceRoot, branch.adoptWorkspace),
          );
          return;
        }
        case "newWindow": {
          // The remote window runs its own routeOpenBySize when the cold-start
          // queue drains, so we do NOT mark a tab here (none exists in this
          // window). The refusal / warning dialog above already applied.
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
          pendingFetchedRef.current = true;
          const pending = await invoke<PendingFileOpen[]>("get_pending_file_opens");
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
