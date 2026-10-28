/**
 * Review client — the review panel's own decisions on live hunks over the
 * agent edit journal (`agent_journal_review_decide`): keep, un-keep, mark
 * handled, and "Clear reviewed".
 *
 * Key decisions:
 *   - Each decision names the head the panel rendered (`null` is genesis)
 *     and every hunk's `reviewGen`: the journal applies it only when both
 *     still hold, so a decision on a stale panel is `STALE_REVIEW`.
 *   - Retry safety is that CAS: a decision is applied at most once. A
 *     resent decision whose reply was lost finds its `reviewGen` moved and
 *     is refused `STALE_REVIEW`, which cannot say whether the first attempt
 *     landed; the panel re-reads the history and shows what it holds.
 *   - A save still being recorded makes a decision `JOURNAL_BUSY`.
 *   - "Clear reviewed" sends, in one batch, exactly the hunks the review
 *     matrix lets it settle, and sends nothing when there are none.
 *   - Revert outcomes (`conflicted`, `revertFoundBase`) are not decisions
 *     the panel can send; the revert admission decides them.
 *
 * @coordinates-with src-tauri/src/agent_journal/controller_review.rs — the command
 * @module services/agentJournal/reviewClient
 */

import { callJournalBound, isDecimal, isObject, malformed } from "./journalIpc";
import { JournalRefusal } from "./journalRefusal";
import type { DocumentHistory, LiveHunk } from "./docHistoryClient";
import { nextReviewState } from "./review/reviewTransitions";

const COMMAND = "agent_journal_review_decide";

export type PanelAction = "keep" | "unkeep" | "markHandled" | "clearReviewed";

export interface ReviewItem {
  hunkId: string;
  /** The hunk's `reviewGen` as the panel read it, decimal string. */
  expectedReviewGen: string;
}

export interface ReviewDecision {
  docKey: string;
  expectedHead: string | null;
  action: PanelAction;
  items: ReviewItem[];
}

export interface ReviewDecided {
  /** The journal generation of the appended decision, decimal string. */
  generation: string;
}

const itemOf = (h: LiveHunk): ReviewItem => ({ hunkId: h.hunkId, expectedReviewGen: h.reviewGen });

/** Record one decision. Rejects with a `JournalRefusal`; an empty decision is refused before anything is sent. */
export async function decideReview(decision: ReviewDecision): Promise<ReviewDecided> {
  if (decision.items.length === 0) throw new JournalRefusal("INVALID_REQUEST", `${COMMAND}: a decision names at least one hunk`);
  const { docKey, expectedHead, action, items } = decision;
  const r = await callJournalBound(COMMAND, { payload: JSON.stringify({ docKey, expectedHead, action, items }) });
  if (!isObject(r) || Object.keys(r).length !== 1 || !isDecimal(r.generation)) throw malformed(COMMAND);
  return { generation: r.generation };
}

const decideOne = (action: PanelAction) => (docKey: string, head: string | null, hunk: LiveHunk) =>
  decideReview({ docKey, expectedHead: head, action, items: [itemOf(hunk)] });

/** Keep `hunk` (pending or conflicted). */
export const keepHunk = decideOne("keep");
/** Return a kept `hunk` to pending. */
export const unkeepHunk = decideOne("unkeep");
/** Mark a conflicted `hunk` handled by hand. */
export const markHunkHandled = decideOne("markHandled");

/** The hunks "Clear reviewed" settles. */
export const clearableHunks = (hunks: readonly LiveHunk[]): LiveHunk[] => hunks.filter((h) => nextReviewState("clearReviewed", h.state) !== undefined);

/** Settle every clearable hunk of `history` in one decision; `null` (nothing sent) when there is none. */
export async function clearReviewed(docKey: string, history: DocumentHistory): Promise<ReviewDecided | null> {
  const items = clearableHunks(history.hunks).map(itemOf);
  if (items.length === 0) return null;
  return decideReview({ docKey, expectedHead: history.head, action: "clearReviewed", items });
}
