/**
 * Review transitions — the hunk review state machine the panel decides
 * against: for each review event, the state a hunk in a given state moves
 * to; an absent entry is a transition the journal refuses.
 *
 * Key decisions:
 *   - The table is a typed literal, not a read of the test fixture; its
 *     equality with `transitions.json` (which the Rust matrix also equals)
 *     is pinned by a test, so the three cannot drift apart.
 *   - There is no `reverted → conflicted` edge: a refused revert of a
 *     revert changes nothing.
 *
 * @coordinates-with src-tauri/src/agent_journal/review_matrix.rs — the same matrix in Rust
 * @module services/agentJournal/review/reviewTransitions
 */

export const HUNK_STATES = ["pending", "kept", "reverted", "conflicted", "superseded", "resolvedByHumanEdit", "settled"] as const;
export type HunkState = (typeof HUNK_STATES)[number];

/** The user's events, then the capture's (a save superseding or resolving a hunk). */
export const REVIEW_EVENTS = [
  "keep",
  "unkeep",
  "revertApplied",
  "revertRefused",
  "revertOfRevertApplied",
  "revertFoundBase",
  "markHandled",
  "clearReviewed",
  "supersede",
  "humanResolve",
] as const;
export type ReviewEvent = (typeof REVIEW_EVENTS)[number];

export const REVIEW_TRANSITIONS: Readonly<Record<ReviewEvent, Readonly<Partial<Record<HunkState, HunkState>>>>> = {
  keep: { pending: "kept", conflicted: "kept" },
  unkeep: { kept: "pending" },
  revertApplied: { pending: "reverted", conflicted: "reverted" },
  revertRefused: { pending: "conflicted" },
  revertOfRevertApplied: { reverted: "pending" },
  revertFoundBase: { pending: "resolvedByHumanEdit", conflicted: "resolvedByHumanEdit" },
  markHandled: { conflicted: "resolvedByHumanEdit" },
  clearReviewed: { kept: "settled", reverted: "settled", superseded: "settled", resolvedByHumanEdit: "settled" },
  supersede: { pending: "superseded", conflicted: "superseded" },
  humanResolve: { pending: "resolvedByHumanEdit", conflicted: "resolvedByHumanEdit" },
};

/** The state `event` moves a hunk in `from` to, or `undefined` when the journal refuses it. */
export function nextReviewState(event: ReviewEvent, from: HunkState): HunkState | undefined {
  return REVIEW_TRANSITIONS[event][from];
}
