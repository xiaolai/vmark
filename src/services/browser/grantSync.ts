/**
 * Grant sync — mirror the user's standing grants into the Rust driver (WI-2.1).
 *
 * Purpose: the driver (`src-tauri/src/browser/origin_guard.rs`) is the
 * **authoritative** enforcement point for R4/R5/R7a — it refuses any `browser_eval`
 * whose committed origin does not grant the operation. Its grant set is therefore
 * the one that matters, and it must track the user's approvals rather than be
 * supplied by whoever happens to be calling.
 *
 * This subscribes to the approval store and pushes the grant list on every change,
 * so:
 *   - a revocation reaches the driver immediately (a stale permissive copy would
 *     be a security bug, not a staleness annoyance);
 *   - a caller cannot influence what the driver believes it may do — the grants
 *     flow only from the user's approvals.
 *
 * Default-deny holds if this never runs: the driver starts with an empty set.
 *
 * @coordinates-with stores/browserApprovalStore.ts — the source of truth for grants
 * @coordinates-with src-tauri browser_set_grants — the driver's mirror
 * @module services/browser/grantSync
 */

import { invoke } from "@tauri-apps/api/core";
import {
  useBrowserApprovalStore,
  type OneShotApproval,
} from "@/stores/browserApprovalStore";
import type { StandingGrant } from "@/lib/browser/approval/grants";
import { browserWarn } from "@/utils/debug";

/** How many times a failed grant push is retried before giving up loudly. Bounds
 *  a permanently-unreachable driver from spinning while still healing the common
 *  transient failure — the next legitimate change re-pushes the full state anyway. */
const MAX_PUSH_ATTEMPTS = 3;

/**
 * A serialized, coalescing pusher for the full grant snapshot.
 *
 * `browser_set_grants` replaces the driver's whole grant vector, so only the
 * LATEST snapshot matters — but Tauri does not guarantee two concurrently
 * dispatched commands complete in call order. A fire-and-forget push therefore
 * risks an older snapshot landing after a newer revocation, leaving the authority
 * permissive. This runs at most one push at a time and always re-reads the latest
 * desired snapshot, so the driver observes changes in order and converges on the
 * final state. A failed push is retried (bounded) rather than silently abandoned,
 * so a revocation whose sync failed is not left stale.
 */
function makeGrantPusher(): (grants: StandingGrant[]) => void {
  let desired: StandingGrant[] | null = null;
  let running = false;
  let attempts = 0;

  async function drain(): Promise<void> {
    if (running) return; // the running loop will pick up the newer `desired`
    running = true;
    try {
      while (desired !== null) {
        const snapshot = desired;
        desired = null;
        try {
          await invoke("browser_set_grants", { grants: snapshot });
          attempts = 0;
        } catch (error) {
          browserWarn("grant sync failed; retrying", error);
          if (desired !== null) {
            attempts = 0; // a newer snapshot supersedes this one — push that instead
          } else if (++attempts < MAX_PUSH_ATTEMPTS) {
            desired = snapshot; // re-queue: never silently abandon a revocation
          } else {
            attempts = 0;
            browserWarn(
              "grant sync giving up after retries; the driver may hold a stale grant set",
            );
          }
        }
      }
    } finally {
      running = false;
    }
  }

  return (grants) => {
    desired = grants;
    void drain();
  };
}

/**
 * Send a newly minted "Allow once" to the driver.
 *
 * One-shots are ADDED, never wholesale replaced: the driver consumes them as
 * actions are performed, so pushing the full list would resurrect authority the
 * user already spent.
 */
function pushOneShot(shot: OneShotApproval): void {
  // The driver binds the one-shot to (tab, generation, origin, operation, target).
  //
  // The generation is the one the APPROVAL WAS RAISED AGAINST, sent explicitly. The driver
  // used to stamp it from the registry at mint time — so if the page navigated between the
  // prompt appearing and the user clicking "Allow once", the approval landed on the new
  // page's generation and authorized an action on a page the user never saw. The driver now
  // refuses a mint whose generation is no longer current, which turns that race into a
  // refusal instead of an escalation. (Audit, High.)
  void invoke("browser_add_one_shot", {
    tabId: shot.tabId,
    generation: shot.generation,
    originPattern: shot.originPattern,
    operation: shot.operation,
    target: shot.target,
    // The exact script (for `style`/`eval`) so the driver binds the payload hash and
    // refuses a substituted retry. The driver REQUIRES it for those operations —
    // without it the mint is rejected, so "Allow once" would authorize nothing rather
    // than the wrong thing. (Security review P5, High #1.)
    evalScript: shot.script,
  }).catch((error: unknown) => {
    browserWarn("one-shot sync failed; the driver will refuse the action", error);
  });
}

/**
 * Start mirroring the user's authorizations to the driver — the authoritative
 * gate. Pushes grants once immediately (so a driver that just started is not left
 * denying grants the user already made), then on every change, and forwards each
 * newly minted one-shot.
 *
 * Without the one-shot leg, "Allow once" authorizes the frontend and is then
 * REFUSED by the driver, which demands a standing grant it will never see.
 *
 * Returns a disposer.
 */
export function startGrantSync(): () => void {
  // One serialized pusher per sync session — its lifecycle matches the
  // subscription, so a torn-down session leaves no in-flight drain behind.
  const push = makeGrantPusher();
  push(useBrowserApprovalStore.getState().grants);

  let previousGrants = useBrowserApprovalStore.getState().grants;
  let previousShots = useBrowserApprovalStore.getState().oneShots;
  return useBrowserApprovalStore.subscribe((state) => {
    // Reference compare: the store's actions always produce new arrays, and
    // unrelated churn (pending approvals) must not spam the driver.
    if (state.grants !== previousGrants) {
      previousGrants = state.grants;
      push(state.grants);
    }
    if (state.oneShots !== previousShots) {
      // Forward only the ADDITIONS. A shrinking list means the frontend spent its
      // mirror copy; the driver has spent its own and must not be told again.
      const added = state.oneShots.filter((s) => !previousShots.includes(s));
      previousShots = state.oneShots;
      for (const shot of added) pushOneShot(shot);
    }
  });
}
