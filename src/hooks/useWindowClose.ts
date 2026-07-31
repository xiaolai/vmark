/**
 * Window Close Hook
 *
 * Purpose: Handles window-level and tab-level close events — menu:close
 *   closes the active tab (with dirty check), while traffic-light close and
 *   Cmd+Q close the entire window after saving dirty documents.
 *
 * Pipeline (window close): Traffic light / Cmd+Q → Tauri close-requested →
 *   this hook → runWindowCloseFlow (prompts, revalidation, cleanup, persist,
 *   native close) → allow close or cancel
 *
 * Pipeline (menu close): Cmd+W menu accelerator → menu:close event →
 *   closeTabWithDirtyCheck (active tab). When the window is already empty
 *   (Welcome screen), Cmd+W closes the window itself via handleCloseRequest.
 *
 * Key decisions:
 *   - The active close is a SHARED PROMISE, not a boolean guard (WI-1).
 *     Duplicate triggers join it and get the real outcome. Critically, an
 *     `app:quit-requested` arriving during an in-flight close now awaits that
 *     close and sends `cancel_quit` when it fails — the boolean guard returned
 *     early without ever answering Rust, leaving quit permanently stuck once
 *     the first close was cancelled.
 *   - Listener setup carries a disposed flag and a rejection handler (WI-8g):
 *     a listener resolving after unmount is unregistered immediately instead
 *     of leaking, and a rejected `listen()` is logged instead of becoming an
 *     unhandled rejection.
 *   - All ordering/revalidation decisions live in windowCloseFlow.ts.
 *
 * @coordinates-with windowCloseFlow.ts — the close transaction itself
 * @coordinates-with useTabOperations.ts — closeTabWithDirtyCheck for menu:close
 * @module hooks/useWindowClose
 */

import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useWindowLabel } from "../contexts/WindowContext";
import { useTabStore } from "../stores/tabStore";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import { runWindowCloseFlow } from "@/hooks/windowCloseFlow";
import { safeUnlisten } from "@/utils/safeUnlisten";
import { windowCloseLog, windowCloseWarn, windowCloseError } from "@/utils/debug";

// Dev-only logging for debugging window close issues
// Logs to console and Rust debug_log
/* v8 ignore start -- import.meta.env.DEV=true in vitest; production no-op branch never reached in tests */
const closeLog = import.meta.env.DEV
  ? (label: string, ...args: unknown[]) => {
      const msg = `[WindowClose:${label}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
      windowCloseLog(msg);
      // Log to terminal via Rust (fire-and-forget, but log failures in dev)
      invoke("debug_log", { message: msg }).catch((e) => {
        windowCloseWarn("debug_log invoke failed:", e);
      });
    }
  : () => {};
/* v8 ignore stop */

/**
 * Handle window and tab close events with save confirmation.
 * Listens to:
 * - menu:close (Cmd+W) — closes the active tab (not the window)
 * - window:close-requested (traffic light) — closes the entire window
 * - app:quit-requested (Cmd+Q) — closes window as part of app quit
 */
export function useWindowClose() {
  const windowLabel = useWindowLabel();
  /** The in-flight close, shared by every trigger (WI-1/WI-7 shape). */
  const activeCloseRef = useRef<Promise<boolean> | null>(null);
  /** The close attempt Rust was already answered for — cancel_quit is sent
   *  exactly once per attempt, however many quit events joined it. */
  const answeredQuitForRef = useRef<Promise<boolean> | null>(null);

  const handleCloseRequest = useCallback((): Promise<boolean> => {
    closeLog(windowLabel, "handleCloseRequest called");
    // A close is already running — JOIN it. Returning a fake `false` (the old
    // boolean guard) told the caller nothing; quit handlers especially need
    // the real outcome to know whether to send cancel_quit.
    const existing = activeCloseRef.current;
    if (existing) {
      closeLog(windowLabel, "joining in-flight close");
      return existing;
    }

    const run = runWindowCloseFlow(windowLabel, closeLog)
      .catch((error) => {
        windowCloseError("Failed to close window:", error);
        return false;
      })
      .finally(() => {
        activeCloseRef.current = null;
      });
    activeCloseRef.current = run;
    return run;
  }, [windowLabel]);

  useEffect(() => {
    const currentWindow = getCurrentWebviewWindow();
    // WI-8g: listeners resolving AFTER unmount are unregistered on the spot —
    // without this, React Strict Mode's first mount leaks its listeners for
    // the lifetime of the window.
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const track = (promise: Promise<UnlistenFn>) =>
      promise.then((unlisten) => {
        if (disposed) safeUnlisten(unlisten);
        else unlisteners.push(unlisten);
        return unlisten;
      });

    const setup = async () => {
      closeLog(windowLabel, "setting up event listeners");

      // menu:close (Cmd+W): close the active tab. Closing the last tab leaves
      // the window on the Welcome screen; Cmd+W with no active tab falls
      // through to handleCloseRequest (matches VSCode). useTabShortcuts also
      // handles Cmd+W via keydown; the duplicate invocation joins the shared
      // in-flight close.
      await track(
        currentWindow.listen<string>("menu:close", async (event) => {
          if (event.payload !== windowLabel) return;
          closeLog(windowLabel, "menu:close received");
          const activeTabId = useTabStore.getState().activeTabId[windowLabel];
          if (activeTabId) {
            try {
              await closeTabWithDirtyCheck(windowLabel, activeTabId);
            } catch (error) {
              windowCloseError("menu:close tab close failed:", error);
            }
          } else {
            // Empty window (Welcome screen): close the window itself.
            void handleCloseRequest();
          }
        })
      );

      // window:close-requested (traffic light). Tauri broadcasts to all
      // windows, so filter by target label.
      await track(
        currentWindow.listen<string>("window:close-requested", (event) => {
          if (event.payload !== windowLabel) return;
          closeLog(windowLabel, "window:close-requested received");
          void handleCloseRequest();
        })
      );

      // app:quit-requested (Cmd+Q). Joins any in-flight close via the shared
      // promise, and — decisively — answers Rust either way: without the
      // cancel_quit on failure, a cancelled close left quit_in_progress set
      // and Cmd+Q dead for the rest of the session (WI-1).
      await track(
        currentWindow.listen<string>("app:quit-requested", async (event) => {
          if (event.payload !== windowLabel) return;
          const run = handleCloseRequest();
          const closed = await run;
          // Answer Rust exactly once per close ATTEMPT: several quit events
          // can join one close, and each would otherwise send its own
          // cancel_quit. Keyed on the promise identity, not a boolean — a
          // LATER attempt must be answered again.
          if (!closed && answeredQuitForRef.current !== run) {
            answeredQuitForRef.current = run;
            invoke("cancel_quit").catch((e) => {
              /* v8 ignore start -- import.meta.env.DEV=true in vitest; production false-branch never taken */
              if (import.meta.env.DEV) {
                windowCloseWarn("cancel_quit failed:", e);
              }
              /* v8 ignore stop */
            });
          }
        })
      );

      closeLog(windowLabel, "event listeners set up");
    };

    setup().catch((error) => {
      windowCloseError("window close listener setup failed:", error);
    });

    return () => {
      disposed = true;
      unlisteners.forEach(safeUnlisten);
      unlisteners.length = 0;
    };
  }, [windowLabel, handleCloseRequest]);
}
