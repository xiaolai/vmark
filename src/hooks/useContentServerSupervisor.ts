/**
 * useContentServerSupervisor — the crash half of the content server's
 * lifecycle, split out of useContentServer.ts (which sits at the file-size
 * cap), alongside the workspace-sync and Slidev halves.
 *
 * Rust detects an unexpected child exit and emits `content-server:exited`;
 * this hook auto-restarts up to `MAX_CONTENT_SERVER_RESTARTS` times per USER
 * start. The budget is replenished only by a manual Start/Retry, so a server
 * that dies after every spawn cannot loop forever, and the exit that
 * acknowledges a user stop of this root is absorbed rather than restarted
 * (the one-shot `stopIntentRoot` guard — useContentServer's header says why).
 *
 * The listener mounts ONCE (audit #724). It used to depend on
 * `useTranslation`'s `t`, whose identity changes with the language, so a
 * language switch tore the listener down and re-registered it through an
 * `await` — and a crash inside that window reached nothing at all. The message
 * is resolved through the i18n singleton at EVENT time instead: the same
 * `common` namespace, and always the live language.
 *
 * @coordinates-with hooks/useContentServer.ts — mounts this; owns every other transition
 * @coordinates-with src/stores/contentServerStore.ts — the status this writes
 * @module hooks/useContentServerSupervisor
 */
import { useEffect, type RefObject } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useContentServerStore } from "@/stores/contentServerStore";
import { contentServerWarn } from "@/utils/debug";
import type { StartServerRef } from "./useContentServerWorkspaceSync";

/**
 * Auto-restarts the supervisor may issue per USER start (WI-1.2). Replenished
 * only by a manual Start/Retry — never by time or by a restart that held — so it
 * caps crashes per manual session, not "consecutive" ones: the third crash in a
 * session is the last one restarted; the next surfaces an error to retry.
 * Deliberate: a server that crashes after every spawn cannot loop.
 */
export const MAX_CONTENT_SERVER_RESTARTS = 3;

/** Whether the supervisor should auto-restart given prior attempts. Pure. */
export function shouldAutoRestart(
  attempts: number,
  max = MAX_CONTENT_SERVER_RESTARTS,
): boolean {
  return attempts < max;
}

interface ExitPayload {
  workspaceRoot: string;
  code: number | null;
}

/** Mount the `content-server:exited` supervisor for the window's lifetime. */
export function useContentServerSupervisor(refs: {
  /** The supervisor start path, as a ref so the listener never goes stale. */
  startServer: StartServerRef;
  /** Auto-restarts spent since the last manual start. */
  restartAttempts: RefObject<number>;
  /** The root a user stop is waiting to see the exit of; one-shot. */
  stopIntentRoot: RefObject<string | null>;
}): void {
  const { startServer, restartAttempts, stopIntentRoot } = refs;
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void listen<ExitPayload>("content-server:exited", (event) => {
      const root = useWorkspaceStore.getState().rootPath;
      if (!root || event.payload.workspaceRoot !== root) return;
      useContentServerStore.getState().stop();
      // The exit that acknowledges a user stop of THIS root must not restart it.
      if (stopIntentRoot.current === root) {
        stopIntentRoot.current = null;
        return;
      }
      if (shouldAutoRestart(restartAttempts.current)) {
        restartAttempts.current += 1;
        void startServer.current(false);
      } else {
        useContentServerStore.getState().setError(i18n.t("contentServer.error.crashed"));
      }
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((e) => {
        // Listener setup failed → supervision is disabled; surface it loudly
        // rather than letting it become a silent unhandled rejection.
        contentServerWarn("exit-listener setup failed", e);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [startServer, restartAttempts, stopIntentRoot]);
}
