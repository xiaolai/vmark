/**
 * Review rows — the review panel's flat row model, built from one document
 * history: the revisions since the last fully reviewed prefix grouped by
 * actor and session, each live hunk under the revision that made it, and
 * whether the document's review backlog is full.
 *
 * Key decisions:
 *   - A revision is reviewed when none of its live hunks is still `pending`
 *     or `conflicted`. The oldest run of reviewed revisions is summarized
 *     as one count (a cursor may only summarize a fully reviewed prefix);
 *     every revision from the oldest one still holding an undecided hunk up
 *     to the head is shown, reviewed or not, so nothing in between is
 *     hidden.
 *   - Consecutive revisions by the same actor and session form one group:
 *     an MCP actor is its principal, connection and session label (its
 *     self-chosen display name is a detail, not an identity); a person, an
 *     autosave or a legacy record is its type (and reason).
 *   - Hunks keep the journal's order and geometry. Hunks of a revision the
 *     history does not list (a truncated history) are listed apart under
 *     their own header rather than dropped.
 *   - A blocked hunk carries its block, so the row says why its automatic
 *     revert is unavailable.
 *   - The backlog is full at `AGENT_SLOT_LIMIT` non-settled hunks, the
 *     writer's own limit (`review_slots.rs`): from there an agent write
 *     that would add a hunk is refused `REVIEW_BACKLOG_FULL`. The history
 *     lists every non-settled hunk, so its length is that count.
 *   - Pure: no React, no stores, so the model is unit-tested directly.
 *
 * @coordinates-with services/agentJournal/docHistoryClient.ts — the history
 * @coordinates-with src-tauri/src/agent_journal/review_slots.rs — the slot limit
 * @module components/ReviewPanel/reviewRows
 */

import type { BlockedHunk, DocumentHistory, HistoryRow, LiveHunk } from "@/services/agentJournal/docHistoryClient";
import type { JournalActor } from "@/services/agentJournal/journalActor";

/** Non-settled hunks a document may hold before agent writes are refused (`AGENT_SLOT_LIMIT` in `review_slots.rs`). */
export const AGENT_SLOT_LIMIT = 500;

export type ReviewRow =
  | { type: "group"; key: string; actor: JournalActor; revisions: number }
  | { type: "elsewhere"; key: string }
  | { type: "hunk"; key: string; hunk: LiveHunk; blocked: BlockedHunk | null };

export interface ReviewModel {
  rows: ReviewRow[];
  /** Revisions in the summarized, fully reviewed prefix. */
  reviewedPrefix: number;
  /** Hunks still `pending` or `conflicted`. */
  undecided: number;
  backlogFull: boolean;
}

const isUndecided = (h: LiveHunk): boolean => h.state === "pending" || h.state === "conflicted";

/** Who a group is: the same key means the same actor and session. */
export function actorKey(actor: JournalActor): string {
  switch (actor.type) {
    case "mcp":
      return JSON.stringify(["mcp", actor.principal, actor.connectionId, actor.sessionLabel]);
    case "system":
      return JSON.stringify(["system", actor.reason]);
    default:
      return actor.type;
  }
}

function hunksByTarget(hunks: readonly LiveHunk[]): Map<string, LiveHunk[]> {
  const byTarget = new Map<string, LiveHunk[]>();
  for (const h of hunks) {
    const bucket = byTarget.get(h.target);
    if (bucket) bucket.push(h);
    else byTarget.set(h.target, [h]);
  }
  return byTarget;
}

/** Newest-first revisions from the head down to the oldest one with an undecided hunk. */
function shownRevisions(rows: readonly HistoryRow[], byTarget: ReadonlyMap<string, LiveHunk[]>): HistoryRow[] {
  let oldest = -1;
  rows.forEach((r, i) => {
    if ((byTarget.get(r.revision) ?? []).some(isUndecided)) oldest = i;
  });
  return rows.slice(0, oldest + 1);
}

/** The review panel's rows for `history`. */
export function buildReviewModel(history: DocumentHistory): ReviewModel {
  const byTarget = hunksByTarget(history.hunks);
  const blocked = new Map(history.blocked.map((b) => [b.hunkId, b]));
  const hunkRow = (hunk: LiveHunk): ReviewRow => ({ type: "hunk", key: `h:${hunk.hunkId}`, hunk, blocked: blocked.get(hunk.hunkId) ?? null });
  const shown = shownRevisions(history.rows, byTarget);

  const out: ReviewRow[] = [];
  let group: Extract<ReviewRow, { type: "group" }> | null = null;
  for (const r of shown) {
    if (group === null || actorKey(group.actor) !== actorKey(r.actor)) {
      group = { type: "group", key: `g:${r.revision}`, actor: r.actor, revisions: 0 };
      out.push(group);
    }
    group.revisions += 1;
    for (const h of byTarget.get(r.revision) ?? []) out.push(hunkRow(h));
  }

  const listed = new Set(history.rows.map((r) => r.revision));
  const elsewhere = history.hunks.filter((h) => !listed.has(h.target));
  if (elsewhere.length > 0) out.push({ type: "elsewhere", key: "elsewhere" }, ...elsewhere.map(hunkRow));

  return {
    rows: out,
    reviewedPrefix: history.rows.length - shown.length,
    undecided: history.hunks.filter(isUndecided).length,
    backlogFull: history.hunks.length >= AGENT_SLOT_LIMIT,
  };
}
