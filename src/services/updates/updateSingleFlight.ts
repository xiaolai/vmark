/**
 * Update single-flight guards.
 *
 * Purpose: hold the per-window in-flight promises for the update check and
 *   download, and expose the ONE way to release them.
 *
 * Key decisions:
 *   - Lives outside `useUpdateOperations` because the recovery path has to be
 *     able to reach these guards. While they were module-private to that hook,
 *     nothing could clear them, which is what made a stalled flow permanent.
 *   - Held in a holder object rather than two `let`s so the formatter doesn't
 *     rewrite the reassignment to `const`.
 *
 * Why this exists at all — the failure it guards against:
 *   Both guards are cleared in a `.finally()`. That is correct only while the
 *   awaited promise is guaranteed to settle. `check()` and
 *   `downloadAndInstall()` are network calls, and a connection that STALLS
 *   never settles — it neither resolves nor rejects. When that happens the
 *   guard stays non-null forever, every later caller returns the same dead
 *   promise and awaits it forever, and the feature is bricked for the life of
 *   the window.
 *
 *   This is the same mechanism as the window-close stall (#1253), where
 *   `activeCloseRef` was likewise cleared only in `.finally()` and one
 *   unsettled step made every later close request join a dead promise. Two
 *   instances of one defect: the fix is a release valve, not another guard.
 *
 * @coordinates-with useUpdateOperations.ts — sets and awaits these guards
 * @coordinates-with useUpdateStall.ts — detects the stall that calls for release
 * @module services/updates/updateSingleFlight
 */

/**
 * Per-window in-flight gates. Spam-clicks, the auto-retry timer and the
 * auto-download effect all await the same promise rather than issuing
 * parallel calls into the Tauri updater plugin (parallel-check churn was a
 * contributor to the v0.7.11 freeze).
 */
export const inFlight: {
  check: Promise<boolean> | null;
  download: Promise<boolean> | null;
} = {
  check: null,
  download: null,
};

/**
 * Release both guards so the next caller reaches the plugin instead of
 * joining a promise that will never settle.
 *
 * This does NOT cancel whatever is still pending underneath — the Tauri
 * updater exposes no cancellation. The caller is expected to also drop
 * `pendingUpdate`, so a retry runs a fresh `check()` and operates on a NEW
 * Update resource rather than re-entering `downloadAndInstall` on the same
 * one (which the plugin does not support).
 */
export function clearInFlight(): void {
  inFlight.check = null;
  inFlight.download = null;
}
