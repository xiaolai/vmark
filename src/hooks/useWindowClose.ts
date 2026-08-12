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
 * @coordinates-with services/tabs/tabOperations.ts — closeTabWithDirtyCheck for menu:close
 * @module hooks/useWindowClose
 */

import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useWindowLabel } from "../contexts/WindowContext";
import { useTabStore } from "../stores/tabStore";
import { closeTabWithDirtyCheck } from "@/services/tabs/tabOperations";
import { runWindowCloseFlow } from "@/services/windowClose/windowCloseFlow";
import { safeUnlisten } from "@/utils/safeUnlisten";
import { windowCloseLog, windowCloseWarn, windowCloseError } from "@/utils/debug";

/**
 * Close-flow milestones — logged in RELEASE builds too (#1253).
 *
 * This used to be `import.meta.env.DEV ? … : () => {}`, so a shipped build
 * recorded nothing about a window close. When a user reported a window that
 * could not be closed, the log they sent was silent — not because nothing
 * happened, but because every line describing it had been compiled out. The
 * Rust side had the same problem (`debug!`, filtered at the release Info
 * level), so there was no way to tell which await never returned.
 *
 * Routes to `window_close_log`, which logs at INFO, rather than `debug_log`,
 * which is `debug!` and would still vanish. Console output stays dev-only:
 * `windowCloseLog` is already a no-op in production, and the file log is what
 * a user can actually send.
 */
const closeLog = (label: string, ...args: unknown[]) => {
  const msg = `[WindowClose:${label}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
  windowCloseLog(msg);
  // Fire-and-forget: logging must never be able to fail a close.
  invoke("window_close_log", { message: msg }).catch((e) => {
    /* v8 ignore start -- import.meta.env.DEV=true in vitest; production branch never taken */
    if (import.meta.env.DEV) {
      windowCloseWarn("window_close_log invoke failed:", e);
    }
    /* v8 ignore stop */
  });
};

/**
 * How long an in-flight close may sit before a NEW close request is treated as
 * a retry rather than joined to it (#1253).
 *
 * Generous on purpose: the flow legitimately blocks on native save/pin dialogs,
 * and a user reading one must never be interrupted by a second. Five minutes is
 * far longer than any real prompt takes to answer and far shorter than "the
 * window is permanently unclosable", which is what the previous unbounded join
 * produced.
 */
const STALL_RETRY_AFTER_MS = 5 * 60 * 1000;

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
  /** When that attempt started — the basis for the stall check below. */
  const activeCloseStartedAtRef = useRef<number>(0);
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
      const age = Date.now() - activeCloseStartedAtRef.current;
      if (age < STALL_RETRY_AFTER_MS) {
        closeLog(windowLabel, "joining in-flight close");
        return existing;
      }
      // Stalled (#1253). `activeCloseRef` is cleared only when the flow
      // SETTLES, so a step that never settles made every later close request
      // join a dead promise — the user clicks the traffic light again and
      // again and nothing happens, with no way out but killing the process.
      // Nothing in the flow has a timeout, and every decision point is a
      // blocking native dialog that can only resolve, never reject.
      //
      // A fresh attempt is the conservative recovery: it cancels nothing,
      // forces nothing, and discards no buffer. It costs at worst a second
      // prompt for a user who walked away mid-dialog — and that user has just
      // asked to close again, so acting on the newer request is right.
      closeLog(windowLabel, `in-flight close stalled for ${age}ms — starting a fresh attempt`);
    }

    const run = runWindowCloseFlow(windowLabel, closeLog)
      .catch((error) => {
        windowCloseError("Failed to close window:", error);
        return false;
      })
      .finally(() => {
        // Only retire OUR attempt. A stalled flow that finally settles after a
        // fresh one started would otherwise null the newer attempt's ref,
        // letting a third request run a third flow concurrently.
        if (activeCloseRef.current === run) activeCloseRef.current = null;
      });
    activeCloseRef.current = run;
    activeCloseStartedAtRef.current = Date.now();
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
