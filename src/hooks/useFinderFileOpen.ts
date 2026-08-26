import { useEffect, useRef } from "react";
// Global listen() is correct here — Rust emits app:open-file via app.emit() (global
// broadcast), and only global listen() is guaranteed to receive global events.
// See: https://v2.tauri.app/develop/calling-frontend
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { useWindowLabel } from "@/contexts/WindowContext";
import { loadFileIntoTab } from "@/services/navigation/loadFileIntoTab";
import { dispatchFinderOpen } from "@/services/navigation/finderOpenDispatch";
import type { FinderBranchContext } from "@/services/navigation/finderOpenBranches";
import { waitForRestoreComplete, RESTORE_WAIT_TIMEOUT_MS } from "@/services/persistence/hotExit/hotExitCoordination";
import { finderFileOpenWarn, finderFileOpenError } from "@/utils/debug";
import { commandErrorMessage } from "@/services/commands/commandError";

export interface OpenFilePayload {
  path: string;
  workspace_root: string | null;
  /** Present for hot opens; omitted for the main-window cold-start queue. */
  target_window_label?: string;
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
 * 2. If the file belongs to this window's workspace (or rail mode is on) ->
 *    lands it here, reusing an empty (replaceable) tab when there is one
 * 3. Otherwise -> opens file in a new window (different workspace)
 *
 * Reusing the empty tab never re-roots the window; `resolveFinderOpenBranch`
 * owns that decision and hands it down as `adoptWorkspace` (#1330).
 *
 * Every document window listens for targeted hot opens. The main window alone
 * fetches pending files queued during cold start.
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
    /**
     * Toast a localized "failed to open file" error — used by every
     * read-failure branch so users always see the cause instead of an
     * empty tab or a silent no-op.
     */
    const toastOpenFailure = (error: unknown) => {
      const msg = commandErrorMessage(error);
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

    /** Enqueue a file open, serialized to prevent concurrent tab races */
    const enqueueFileOpen = (
      path: string,
      workspaceRoot: string | null,
      finishDrainedBatch = false,
    ) => {
      processingChainRef.current = processingChainRef.current
        .then(() => dispatchFinderOpen(branchCtx, path, workspaceRoot, finishDrainedBatch))
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
      const target = event.payload.target_window_label;
      // Hot opens are global broadcasts tagged for exactly one document
      // window. Untargeted payloads are the legacy/cold-start shape and remain
      // main-only so multiple windows can never open the same file.
      if (target ? target !== windowLabel : windowLabel !== "main") {
        return;
      }
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
     * 4. In main only, call get_pending_file_opens (which flips Rust's
     *    FRONTEND_READY flag)
     *
     * Events that arrive before restore completes are queued and processed
     * after restore finishes, preventing content from being overwritten.
     */
    void (async () => {
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

        // Main alone fetches and processes files queued during cold start.
        // This handles the race where Finder opens a file before React mounts
        // without letting multiple document windows compete for one queue.
        /* v8 ignore start -- pendingFetchedRef already-fetched guard not exercised in tests */
        if (windowLabel === "main" && !pendingFetchedRef.current) {
          if (cancelled) return;
          // Flip only AFTER the invoke resolves. Setting it first meant a
          // rejected fetch left the flag true, so the cold-start queue was
          // never retried for the life of this mount and files opened from
          // Finder before React mounted simply never appeared.
          const pending = await invoke<PendingFileOpen[]>("get_pending_file_opens");
          pendingFetchedRef.current = true;
          // The Rust command has destructively drained this batch. Finish
          // handing it to the process-wide stores even if React unmounted the
          // listener while the invoke was in flight; returning here would lose
          // files that a replacement mount can no longer fetch.
          for (const file of pending) {
            enqueueFileOpen(file.path, file.workspace_root, true);
          }
        }
        /* v8 ignore stop */
      } catch (error) {
        finderFileOpenError("Init failed:", error);
      }
    })().catch((err) => finderFileOpenError("Finder file-open bootstrap failed:", err));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [windowLabel]);
}
