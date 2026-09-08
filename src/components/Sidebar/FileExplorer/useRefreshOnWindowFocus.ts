/**
 * useRefreshOnWindowFocus — the file tree's safety net against a missed
 * filesystem event.
 *
 * Purpose: the native watcher is the primary signal; this is the backstop.
 * A file created by another application while VMark was in the background can
 * arrive as no event at all, and the user's first act on returning is to look
 * at the tree. Regaining focus therefore asks for a scan.
 *
 * Split out of `useFileTree` (audit R3 #650), where it sat between the loader
 * and the watcher lifecycle as a third, unrelated subscription. Nothing about
 * it is specific to the file tree except its caller — it listens, and it calls
 * back.
 *
 * The listener is registered ASYNCHRONOUSLY, so the teardown has to cover the
 * window between "asked to listen" and "listening": a `cancelled` flag, and an
 * unlisten invoked immediately if the promise resolves after unmount.
 *
 * @coordinates-with ./useFileTree.ts — the only consumer
 * @coordinates-with ./rescanScheduler.ts — what `onFocus` usually asks
 * @module components/Sidebar/FileExplorer/useRefreshOnWindowFocus
 */
import { useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { fileExplorerError } from "@/utils/debug";
import { commandErrorMessage } from "@/services/commands/commandError";

/**
 * Call `onFocus` whenever this window regains focus, while `enabled`.
 *
 * `onFocus` is read from the latest render through the effect's dependency, so
 * a caller passing an inline arrow re-subscribes rather than calling a stale
 * one — the subscription is cheap and this keeps the contract obvious.
 */
export function useRefreshOnWindowFocus(enabled: boolean, onFocus: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    getCurrentWebviewWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) onFocus();
      })
      .then((u) => {
        if (cancelled) {
          u();
        } else {
          unlisten = u;
        }
      })
      .catch((error: unknown) => {
        fileExplorerError(" Failed to listen for window focus:", commandErrorMessage(error));
      });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [enabled, onFocus]);
}
