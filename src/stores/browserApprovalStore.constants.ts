/**
 * Constants shared by the browser approval store and its split-out resolve step
 * (a leaf so `browserApprovalStore.resolve.ts` does not import the store itself).
 *
 * @module stores/browserApprovalStore.constants
 */

/** Cap on queued approval prompts. The AI client is untrusted and each pending
 *  entry may hold a full script; beyond this a further request is dropped rather
 *  than growing the store unbounded. Only one prompt shows at a time anyway. */
export const MAX_PENDING_APPROVALS = 64;

/**
 * Cap on minted, unspent one-shots — the driver's `MAX_ONE_SHOTS` (mint.rs), pinned
 * by `approvalCapParity.test.ts`. Both sides evict the OLDEST unspent one-shot when a
 * new approval arrives at the cap: a stale one-shot is bound to a generation the tab
 * has almost certainly left, while the newest is the one the user just approved.
 * The frontend used to mint without bound while the driver refused past 256, so the
 * UI kept an approval the authority had rejected.
 */
export const MAX_ONE_SHOTS = 256;
