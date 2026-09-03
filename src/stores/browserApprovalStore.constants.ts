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
