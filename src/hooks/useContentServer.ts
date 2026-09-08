/**
 * useContentServer (Phase 5; grill H7) — React adapter wiring the content-server
 * service to the store. Supplies start/stop/openInBrowser bound to the current
 * workspace; the KB panel consumes these. The hook is the only place that turns
 * service calls into store transitions.
 *
 * The frontend half of the supervisor policy (WI-1.2, ADR-10) lives in the
 * sibling `useContentServerSupervisor`: Rust detects an unexpected child exit
 * and emits `content-server:exited`, and that hook auto-restarts up to
 * `MAX_CONTENT_SERVER_RESTARTS` times. A manual start (user clicking
 * Start/Retry) resets the budget; auto-restarts never do, so a server that
 * crashes immediately after every spawn cannot loop forever.
 *
 * Trust (WI-FL3.6): every start carries the workspace's live trust, which the
 * server turns into its CSP (`img-src` gains `https:` when trusted) — and the
 * CSP is baked into the child at spawn. So a trust flip while serving restarts
 * the server through the same start path (Rust replaces a mismatched child),
 * and a start whose handle reports stale trust — the flip landed mid-flight —
 * is issued again with the live value.
 *
 * Lifecycle operations are generation-stamped (audit #363–#365, #370): every
 * start or stop takes the next generation, and a result that arrives after a
 * later operation began — or after the workspace moved on — is dropped rather
 * than committed. A superseded start never stops the child it spawned: Rust's
 * ContentServerManager is app-wide and keyed by root, so another window may be
 * serving that root, the manager reuses the child on return, and shutdown_all
 * reaps it at exit.
 *
 * A user stop records the ROOT it stopped (#367/#371): that root's exit signal
 * is the stop's acknowledgement, never a crash to restart — no timer (a 3 s
 * window reclassified a late exit as a crash), no boolean (blind to the root),
 * and no release when the stop settles (the echo is not ordered against the
 * stop's own reply, so releasing there restarted what the user just stopped).
 * The guard is ONE-SHOT: spent by the exit it absorbs, or re-armed by the next
 * manual start. At most one exit can predate a stop — an intentional stop emits
 * none (Rust's supervisor ends quietly once the registration is gone), and a
 * later exit needs a new child, hence a new start — so the crash after that is
 * still reported. A refused stop is an error, not "stopped" (#366): the child
 * may live, so its guard is released and its exit is a crash. The status that
 * follows it is ASKED, not assumed (#719) — a stop the backend refused while
 * the child kept serving goes back to `running`, with the failure shown as a
 * toast, because `useContentServerWorkspaceSync` acts only on `running` and an
 * `error` over a live child silently disabled the trust-flip restart.
 *
 * @coordinates-with src/stores/workspaceStore.ts — `isWorkspaceTrusted`, `trustWorkspace`, `untrustWorkspace`
 * @coordinates-with hooks/useContentServerWorkspaceSync.ts — workspace switch (#513) and trust flip while serving
 * @coordinates-with hooks/useContentServerSupervisor.ts — the crash/auto-restart half
 * @coordinates-with hooks/useSlidevControls.ts — the deck preview/export half of the controls
 * @module hooks/useContentServer
 */

import { commandErrorMessage } from "@/services/commands/commandError";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useContentServerWorkspaceSync } from "./useContentServerWorkspaceSync";
import { useContentServerSupervisor } from "./useContentServerSupervisor";
import { imeToast as toast } from "@/services/ime/imeToast";
import {
  startContentServer,
  stopContentServer,
  getContentServerStatus,
  openKbInBrowser,
  getKbAuthUrl,
} from "@/services/contentServer";
import { useSlidevControls, type SlidevControls } from "./useSlidevControls";

/** Extra starts one user start may issue when trust keeps flipping mid-flight (WI-FL3.6). */
export const MAX_TRUST_RECONCILES = 2;

export interface ContentServerControls extends SlidevControls {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  openInBrowser: () => Promise<void>;
}

/** A lifecycle operation's view of being overtaken. */
interface LifecycleOperation {
  /** A LATER start or stop began: the store belongs to it now. */
  overtaken: () => boolean;
  /** Overtaken, OR the workspace moved on: this operation's results are stale. */
  superseded: () => boolean;
}

/**
 * Take the next lifecycle generation for an operation on `root`, and return the
 * staleness tests bound to it.
 *
 * ONE definition, not two (audit #714). Start and stop each carried their own
 * copy of the `gen !== lifecycleGen.current || rootPath !== root` expression,
 * with a comment on the second saying it was "the SAME test the start path
 * uses" — which is precisely the shape that drifts. It already had: the
 * workspace half reached `stop` only in #718, after the missing half had
 * written workspace A's failure over workspace B's store.
 */
function beginLifecycleOperation(
  lifecycleGen: RefObject<number>,
  root: string | null,
): LifecycleOperation {
  const gen = ++lifecycleGen.current;
  const overtaken = () => gen !== lifecycleGen.current;
  return {
    overtaken,
    superseded: () => overtaken() || useWorkspaceStore.getState().rootPath !== root,
  };
}

export function useContentServer(): ContentServerControls {
  const { t } = useTranslation();
  const restartAttempts = useRef(0);
  // The root a stop is waiting to see the exit of (header); one-shot.
  const stopIntentRoot = useRef<string | null>(null);
  // The generation of the latest lifecycle operation (see the header).
  const lifecycleGen = useRef(0);

  // Core start path, shared by the manual control and the auto-restart monitor.
  // `resetBudget` distinguishes a user-initiated start (fresh restart budget)
  // from a supervisor restart (consumes the budget).
  const startServer = useCallback(
    async (resetBudget: boolean) => {
      const root = useWorkspaceStore.getState().rootPath;
      if (!root) {
        useContentServerStore.getState().setError(t("contentServer.error.noWorkspace"));
        return;
      }
      if (resetBudget) {
        restartAttempts.current = 0;
        stopIntentRoot.current = null; // a fresh manual start re-arms supervision
      }
      const { overtaken, superseded } = beginLifecycleOperation(lifecycleGen, root);
      // Drop a superseded start. When no later operation took the store over, the
      // workspace itself moved on: this window knows of no server for the new
      // root, so say "stopped" rather than leaving it at "starting".
      const abandon = () => {
        if (!overtaken()) useContentServerStore.getState().stop();
      };
      useContentServerStore.getState().setStarting();
      try {
        // Trust flipped while a start was in flight (WI-FL3.6): the server
        // that came up enforces the old value, which the handle reports. Start
        // again with the live value — Rust replaces a mismatched child. Bounded,
        // so a backend that never echoes a boolean cannot keep this spinning.
        for (let reconcile = 0; ; reconcile++) {
          const trusted = useWorkspaceStore.getState().isWorkspaceTrusted();
          const handle = await startContentServer(root, trusted);
          if (superseded()) return abandon();
          // Compare trust BEFORE publishing anything (audit #716). Announcing
          // `running` and minting an auth URL first advertised — and handed the
          // in-app iframe a live nonce for — a child enforcing the OLD CSP,
          // which on an untrust is exactly the window that must not exist.
          const stale =
            typeof handle.trusted === "boolean" &&
            handle.trusted !== useWorkspaceStore.getState().isWorkspaceTrusted();
          if (stale) {
            if (reconcile < MAX_TRUST_RECONCILES) continue;
            // FAIL CLOSED (audit #717): trust moved through every reconcile, so
            // this handle's CSP still contradicts the live setting. Publishing
            // it is the fail-OPEN the bound was supposed to prevent; the next
            // settled flip restarts through useContentServerWorkspaceSync.
            useContentServerStore.getState().setError(t("contentServer.error.trustUnsettled"));
            return;
          }
          useContentServerStore.getState().setRunning(handle.url, handle.port);
          // grill M2 — the in-app iframe authenticates via a one-time nonce URL
          // (SameSite=Strict blocks header/cookie auth on a cross-origin frame).
          // Codex audit: if only the auth URL fails, stay running (the iframe can
          // retry) — but clear any stale nonce URL so the panel doesn't load a
          // dead `/__auth` link.
          let authUrl: string | null;
          try {
            authUrl = await getKbAuthUrl(root);
          } catch {
            authUrl = null;
          }
          if (superseded()) return abandon();
          useContentServerStore.getState().setIframeUrl(authUrl);
          break;
        }
      } catch (e) {
        if (superseded()) return abandon();
        useContentServerStore.getState().setError(commandErrorMessage(e));
      }
    },
    [t],
  );

  const start = useCallback(() => startServer(true), [startServer]);

  const stop = useCallback(async () => {
    const root = useWorkspaceStore.getState().rootPath;
    stopIntentRoot.current = root; // an exit for THIS root while the stop runs IS the stop
    // The SAME test the start path uses, from the SAME definition now (#714/#718).
    // A workspace switch does not touch the generation, so a stop that failed for
    // workspace A used to write its error over workspace B's store — which the
    // sync hook had just reset to `stopped` for a root this window is not
    // serving at all.
    const { superseded } = beginLifecycleOperation(lifecycleGen, root);
    if (root) {
      try {
        await stopContentServer(root);
      } catch (e) {
        // The child may be alive (#366): an error, never "stopped"; a later exit is a crash.
        if (superseded()) return;
        stopIntentRoot.current = null;
        // ASK the backend rather than assume the child died (audit #719). A
        // refused stop that left the server serving used to be modelled as
        // `error`, and `useContentServerWorkspaceSync` only reacts to
        // `running` — so a trust flip after one was silently ignored and the
        // live child went on serving the old CSP. The status has to describe
        // the CHILD; the failure is reported beside it as a toast, which is
        // request-independent and cannot overwrite the lifecycle again.
        let alive: Awaited<ReturnType<typeof getContentServerStatus>>;
        try {
          alive = await getContentServerStatus(root);
        } catch {
          alive = null; // cannot tell — fall through to the error status
        }
        if (superseded()) return;
        if (alive) {
          useContentServerStore.getState().setRunning(alive.url, alive.port);
          toast.error(commandErrorMessage(e));
          return;
        }
        useContentServerStore.getState().setError(commandErrorMessage(e));
        return;
      }
    }
    // A start that began meanwhile owns the store (audit #365): its server must
    // not be hidden by a superseded stop — and it owns the intent too, so a
    // superseded stop must not clear the guard the newer operation set.
    if (superseded()) return;
    // The guard OUTLIVES this settle (#367, round 4). Rust emits no exit for a
    // child an intentional stop removed — the supervisor sees `NotCurrent` and
    // ends silently (`content_server/supervisor.rs`) — so the only exit that can
    // still arrive for this root was emitted BEFORE the stop, by a poll that
    // found the child already gone. Nothing orders that event's delivery against
    // this reply, and released here it read as a crash and restarted the server
    // the user had just stopped. The guard is spent by the exit it absorbs
    // instead, or re-armed by the next manual start; at most one exit can
    // predate a stop, so the crash after that is still reported.
    useContentServerStore.getState().stop();
  }, []);

  const openInBrowser = useCallback(async () => {
    const root = useWorkspaceStore.getState().rootPath;
    if (!root) return;
    try {
      await openKbInBrowser(root);
    } catch (e) {
      // An ACTION failure, not a server failure (#719's class): the server is
      // still up, so moving its status to `error` would both mislead the panel
      // and stop the workspace sync from restarting it on a trust flip.
      toast.error(commandErrorMessage(e));
    }
  }, []);

  // The deck controls are the same store, a different subject — sibling hook
  // so this file stays under the size cap.
  const slidev = useSlidevControls(t);

  // startServer is referenced via a ref so the sibling hooks' subscriptions
  // never go stale and do not need to re-subscribe on every render.
  const startServerRef = useRef(startServer);
  // Synced after commit (read only from the async listeners below). #1063
  useEffect(() => {
    startServerRef.current = startServer;
  });

  // Workspace switch (audit #513) and trust flip (WI-FL3.6) while serving —
  // one subscription, root change first (that hook's header says why).
  useContentServerWorkspaceSync(startServerRef);
  // Crash supervision (WI-1.2), sibling hook so this file stays under the cap.
  useContentServerSupervisor({
    startServer: startServerRef,
    restartAttempts,
    stopIntentRoot,
  });

  return { start, stop, openInBrowser, ...slidev };
}
