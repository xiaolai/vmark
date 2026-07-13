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
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
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
 * Start mirroring grants to the driver. Pushes once immediately (so a driver that
 * just started is not left denying grants the user already made), then on every
 * change. Returns a disposer.
 */
export function startGrantSync(): () => void {
  push(useBrowserApprovalStore.getState().grants);

  let previous = useBrowserApprovalStore.getState().grants;
  return useBrowserApprovalStore.subscribe((state) => {
    // Reference compare: the store's grant actions always produce a new array,
    // and unrelated churn (pending approvals) must not spam the driver.
    if (state.grants === previous) return;
    previous = state.grants;
    push(state.grants);
  });
}
