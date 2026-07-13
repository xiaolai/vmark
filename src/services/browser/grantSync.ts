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

function push(grants: StandingGrant[]): void {
  // A failed sync leaves the driver on its previous set. That is fail-closed for
  // additions (the new grant simply isn't honored) and only ever *more*
  // restrictive than intended, so it is safe to swallow — but never silent.
  void invoke("browser_set_grants", { grants }).catch((error: unknown) => {
    browserWarn("grant sync failed; driver keeps its previous grant set", error);
  });
}

/**
 * Send a newly minted "Allow once" to the driver.
 *
 * One-shots are ADDED, never wholesale replaced: the driver consumes them as
 * actions are performed, so pushing the full list would resurrect authority the
 * user already spent.
 */
function pushOneShot(shot: OneShotApproval): void {
  void invoke("browser_add_one_shot", {
    originPattern: shot.originPattern,
    operation: shot.operation,
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
