/**
 * Review outcome — what the review panel tells the person after a revert or
 * a review decision: one translated message and tone for every revert
 * outcome and every refusal a review action can meet.
 *
 * Key decisions:
 *   - Every outcome row has its own message, so "nothing changed because
 *     the change overlaps another" never reads like "the journal is busy".
 *     A recorded `conflicted` decision and a refused revert of a hunk that
 *     is already `conflicted` are told apart: the first just changed the
 *     hunk's state, the second recorded nothing.
 *   - A revert that applied but could not be confirmed, or could not be
 *     read back, says the document changed and must be checked; it is never
 *     reported as a failure to revert. A history record not confirmed on
 *     disk is said too, with or without that error.
 *   - Any other token is named in the message, and a rejection that is no
 *     journal refusal reads as a failure: never silent, never guessed.
 *   - Pure: the panel translates the key, so the mapping is unit-tested.
 *
 * @coordinates-with services/agentJournal/hunkRevert.ts — the revert outcomes
 * @coordinates-with services/agentJournal/journalRefusal.ts — the refusal tokens
 * @module components/ReviewPanel/reviewOutcome
 */

import type { AbortReason } from "@/services/agentJournal/journalClient";
import { JournalRefusal, type JournalCode } from "@/services/agentJournal/journalRefusal";
import type { HunkRevertOutcome } from "@/services/agentJournal/hunkRevert";

export interface ReviewNotice {
  tone: "success" | "info" | "warning" | "error";
  /** A `statusbar` key. */
  key: string;
  values?: Record<string, string>;
}

const ABORTED: Record<AbortReason, ReviewNotice> = {
  edited: { tone: "warning", key: "review.abortedEdited" },
  closed: { tone: "warning", key: "review.abortedClosed" },
  composing: { tone: "warning", key: "review.abortedComposing" },
  selection: { tone: "warning", key: "review.abortedSelection" },
  applyRefused: { tone: "error", key: "review.abortedApplyRefused" },
};

const REFUSED: Partial<Record<JournalCode, ReviewNotice>> = {
  AMBIGUOUS_REVERT: { tone: "warning", key: "review.refusedAmbiguous" },
  STALE_REVIEW: { tone: "warning", key: "review.refusedStale" },
  STALE_PARENT: { tone: "warning", key: "review.refusedStaleParent" },
  REVIEW_BACKLOG_FULL: { tone: "error", key: "review.refusedBacklogFull" },
  REVIEW_STATE_EXHAUSTED: { tone: "error", key: "review.refusedExhausted" },
  JOURNAL_BUSY: { tone: "warning", key: "review.refusedBusy" },
};

function refusalNotice(refusal: JournalRefusal): ReviewNotice {
  if (refusal.journalCode === "REVERT_REFUSED") {
    if (refusal.revertReason === "conflicted") return { tone: "warning", key: "review.refusedConflicted" };
    if (refusal.revertReason === "reapply") return { tone: "warning", key: "review.refusedReapply" };
  }
  return REFUSED[refusal.journalCode] ?? { tone: "error", key: "review.refusedOther", values: { code: refusal.journalCode } };
}

/** The message for a hunk revert's outcome. */
export function revertNotice(outcome: HunkRevertOutcome): ReviewNotice {
  switch (outcome.status) {
    case "applied":
      return outcome.durable ? { tone: "success", key: "review.outcomeReverted" } : { tone: "warning", key: "review.outcomeRevertedNotDurable" };
    case "appliedWithError":
      return outcome.durable ? { tone: "warning", key: "review.outcomeRevertedWithError" } : { tone: "warning", key: "review.outcomeRevertedWithErrorNotDurable" };
    case "recoveryRequired":
      return { tone: "error", key: "review.outcomeRecoveryRequired" };
    case "decided":
      return outcome.decision.action === "conflicted"
        ? { tone: "warning", key: "review.outcomeConflicted" }
        : { tone: "info", key: "review.outcomeFoundBase" };
    case "aborted":
      return ABORTED[outcome.reason];
    case "refused":
      return refusalNotice(outcome.refusal);
  }
}

/** The message for a review action that rejected. */
export function errorNotice(error: unknown): ReviewNotice {
  return error instanceof JournalRefusal ? refusalNotice(error) : { tone: "error", key: "review.actionFailed" };
}
