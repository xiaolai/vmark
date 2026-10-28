/**
 * Comment view — the comment panel's pure view model: which actions the
 * person may take on a thread in each state, the notes under a thread's
 * quote, how a referenced id reads once its thread is gone, and the message
 * for every outcome of an action.
 *
 * Key decisions:
 *   - The actions are R36's user column exactly, so the panel never offers a
 *     cell the journal refuses; the journal still checks every one.
 *   - A reopen after the creation revision was collected is allowed; the
 *     thread then says so, ahead of how its anchor resolved against the head.
 *   - Comment ids are writer-minted and never reused, so an id the current
 *     list does not hold is a deleted comment, without a tombstone.
 *   - An ambiguous or orphaned anchor's note asks for attention (the person
 *     must find the text again); the other notes inform.
 *   - Pure: the panel translates the keys, so the mapping is unit-tested.
 *
 * @coordinates-with services/agentJournal/comments/commentReplies.ts — the list shape
 * @coordinates-with components/Comments/CommentsPanel.tsx — where it renders
 * @module components/Comments/commentView
 */

import type { AbortReason } from "@/services/agentJournal/journalClient";
import { JournalRefusal, type JournalCode } from "@/services/agentJournal/journalRefusal";
import type { CommentList, CommentThread, ThreadState } from "@/services/agentJournal/comments/commentReplies";
import type { CommentCreateOutcome } from "@/services/agentJournal/comments/commentCreate";

export type UserCommentAction = "reply" | "markAddressed" | "resolve" | "reopen" | "delete";

/** A `statusbar` key and its values. */
interface CommentNote {
  key: string;
  values?: Record<string, string | number>;
}

export interface CommentNotice extends CommentNote {
  tone: "success" | "info" | "warning" | "error";
}

const USER_ACTIONS: Readonly<Record<ThreadState, readonly UserCommentAction[]>> = {
  open: ["reply", "markAddressed", "resolve"],
  addressed: ["reply", "resolve"],
  reopened: ["reply", "markAddressed", "resolve"],
  resolved: ["reply", "reopen", "delete"],
};

/** The actions the person may take on a thread in `state` (R36). */
export function userActions(state: ThreadState): readonly UserCommentAction[] {
  return USER_ACTIONS[state];
}

/** A note under a thread's quote; `attention` when the person must act (the anchor is lost or unclear). */
interface AnchorNote extends CommentNote {
  attention?: true;
}

/** The notes under a thread's quote: retention first, then the anchor. */
export function anchorNotes(thread: CommentThread): AnchorNote[] {
  const notes: AnchorNote[] = thread.creationRetained ? [] : [{ key: "comments.creationNotRetained" }];
  const { anchor } = thread;
  if (anchor.status === "ambiguous") notes.push({ key: "comments.anchorAmbiguous", values: { count: anchor.candidates.length }, attention: true });
  else if (anchor.status === "orphaned") notes.push({ key: "comments.anchorOrphaned", attention: true });
  else if (anchor.tier === "headingPath") notes.push({ key: "comments.anchorHeading" });
  else if (anchor.tier === "anywhere") notes.push({ key: "comments.anchorAnywhere" });
  return notes;
}

export type CommentRef = { kind: "thread"; thread: CommentThread } | { kind: "deleted" } | { kind: "unknown" };

/** What the id `comment` names in `list`: a thread, a deleted comment, or unknown while nothing is read. */
export function commentRef(comment: string, list: CommentList | null): CommentRef {
  if (!list) return { kind: "unknown" };
  const thread = list.threads.find((t) => t.comment === comment);
  return thread ? { kind: "thread", thread } : { kind: "deleted" };
}

const REFUSED: Partial<Record<JournalCode, CommentNotice>> = {
  STALE_COMMENT: { tone: "warning", key: "comments.refusedStale" },
  COMMENT_NOT_ALLOWED: { tone: "warning", key: "comments.refusedNotAllowed" },
  COMMENT_STORAGE_FULL: { tone: "error", key: "comments.refusedStorageFull" },
  COMMENT_LIMIT: { tone: "error", key: "comments.refusedLimit" },
  COMMENT_ANCHOR_TOO_LONG: { tone: "warning", key: "comments.refusedAnchorTooLong" },
  COMMENT_STATE_EXHAUSTED: { tone: "error", key: "comments.refusedExhausted" },
  JOURNAL_BUSY: { tone: "warning", key: "comments.refusedBusy" },
  STALE_PARENT: { tone: "warning", key: "comments.refusedStaleParent" },
};

const ABORTED: Readonly<Record<AbortReason, CommentNotice>> = {
  edited: { tone: "warning", key: "comments.abortedEdited" },
  closed: { tone: "warning", key: "comments.abortedClosed" },
  composing: { tone: "warning", key: "comments.abortedComposing" },
  selection: { tone: "warning", key: "comments.abortedSelection" },
  applyRefused: { tone: "error", key: "comments.abortedApplyRefused" },
};

/** The message for an action that rejected: a named refusal, any other code, or a failure. */
export function errorNotice(error: unknown): CommentNotice {
  if (!(error instanceof JournalRefusal)) return { tone: "error", key: "comments.failed" };
  return REFUSED[error.journalCode] ?? { tone: "error", key: "comments.refusedOther", values: { code: error.journalCode } };
}

/** The message for a create's outcome. */
export function createNotice(outcome: CommentCreateOutcome): CommentNotice {
  switch (outcome.status) {
    case "created":
      return { tone: "success", key: "comments.created" };
    case "aborted":
      return ABORTED[outcome.reason];
    case "refused":
      return errorNotice(outcome.refusal);
  }
}
