/**
 * useContentServerWorkspaceSync — the workspace-store half of the content
 * server's lifecycle, split out of useContentServer.ts (which sits at the
 * file-size cap). One subscription, two verdicts, in this order:
 *
 *   1. Workspace SWITCH while serving (audit #513): a server the store reports
 *      as running belongs to the root it was started for. When `rootPath`
 *      changes, this window knows of no server for the new root — the verdict
 *      useContentServer's header already gives a start whose workspace moved
 *      on mid-flight — so the store says "stopped" instead of leaving the
 *      previous root's URL in the Knowledge Base panel. Store transition only,
 *      no Rust stop: ContentServerManager is app-wide and keyed by root, so
 *      another window may be serving that root; the manager reuses the child
 *      on return, and shutdown_all reaps it at exit.
 *   2. Trust flip while serving (WI-FL3.6): the served CSP is baked into the
 *      child at spawn, so a flip restarts through the supervisor start path.
 *
 * The order is load-bearing: `openWorkspace` writes `rootPath` and `config` in
 * ONE set(), so a switch to a workspace of different trust used to read as a
 * flip and start a server for the NEW root without the user asking.
 *
 * Only a RUNNING server is affected. A start in flight drops itself through
 * `superseded()` in useContentServer; a stopped or errored store has nothing
 * to say about a root it is not serving.
 *
 * That predicate is only as good as the status (audit #725), so `"error"` now
 * means "no child of ours is serving" in EVERY path: a stop the backend refused
 * re-queries and goes back to `"running"` (#719), and an action failure — a
 * Slidev preview, an export, an external-browser open — is a toast rather than
 * a lifecycle transition (#758). Before that, any of them could leave a live
 * child parked at `"error"`, where a trust flip was ignored and the server went
 * on serving the old CSP.
 *
 * @coordinates-with hooks/useContentServer.ts — mounts this; owns every other transition
 * @coordinates-with src/stores/workspaceStore.ts — `rootPath` and the trust identity
 * @module hooks/useContentServerWorkspaceSync
 */

import { useEffect, type RefObject } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useContentServerStore } from "@/stores/contentServerStore";
import { isTrusted } from "@/utils/workspaceIdentity";

/** The supervisor start path (`startServer(false)`), as a ref so the subscription never goes stale. */
export type StartServerRef = RefObject<(resetBudget: boolean) => Promise<void>>;

export function useContentServerWorkspaceSync(startServer: StartServerRef): void {
  useEffect(
    () =>
      useWorkspaceStore.subscribe((state, prev) => {
        if (useContentServerStore.getState().status !== "running") return;
        if (state.rootPath !== prev.rootPath) {
          useContentServerStore.getState().stop();
          return;
        }
        if (isTrusted(state.config?.identity) === isTrusted(prev.config?.identity)) return;
        void startServer.current(false);
      }),
    [startServer],
  );
}
