/**
 * Test helper — a review writer for the review panel's tests: answers the
 * history read, the review decision and the hunk revert's prepare the way the
 * journal's writer does, over the global `invoke` mock.
 *
 * - A decision is applied only when its head and every item's `reviewGen`
 *   still hold (else `STALE_REVIEW`), through the production transition table,
 *   and bumps each decided hunk's `reviewGen`.
 * - A revert prepare compares the tab's preimage at the hunk's span with the
 *   text the agent wrote there: a human edit over it records one `conflicted`
 *   decision; a second revert of a `conflicted` hunk that still overlaps is
 *   refused `REVERT_REFUSED` with the reason `conflicted`, recording nothing.
 * - A revert prepare that finds the agent's text in place (or, for a
 *   `reverted` hunk, its `base`) is prepared through the journal fake with
 *   the writer's patch; once that transaction commits, the next history read
 *   shows the hunk `reverted` (or `pending` again after a revert of the
 *   revert). The revert's own revision is not listed.
 *
 * @module components/ReviewPanel/__tests__/reviewWriterFake
 */

import { createHash } from "node:crypto";
import { answerPrepare } from "@/test/agentJournalWireFake";
import { agentJournalFake as journal } from "@/test/agentJournalFake";
import type { PrepareInput } from "@/services/agentJournal/journalClient";
import { nextReviewState, type HunkState } from "@/services/agentJournal/review/reviewTransitions";
import type { BlockedHunk, HistoryRow } from "@/services/agentJournal/docHistoryClient";
import type { JournalCode } from "@/services/agentJournal/journalRefusal";

export interface WriterHunk {
  hunkId: string;
  state: HunkState;
  reviewGen: number;
  /** Where the agent's text is in the head. */
  span: { from: number; to: number };
  /** The text the agent wrote there. */
  wrote: string;
  /** The text the agent replaced; scripts an applied revert. */
  base?: string;
  target: string;
}

interface Decision {
  docKey: string;
  expectedHead: string | null;
  action: string;
  items: { hunkId: string; expectedReviewGen: string }[];
}

type Args = Record<string, unknown>;

/** A history row as the command sends it (absent actor strings are omitted). */
export type WireRow = Omit<HistoryRow, "actor"> & { actor: Record<string, unknown> };

export const agentRow = (revision: string, seq: number, connectionId = "c-1"): WireRow => ({
  revision,
  seq: String(seq),
  at: 1_000 * seq,
  kind: "controlled",
  parent: null,
  actor: { type: "mcp", principal: { state: "provider", provider: "claude" }, connectionId },
  initiator: null,
  tool: "document.write",
  restore: false,
  collected: false,
  addresses: [],
});

/** A CommandError-shaped refusal, as the Rust command rejects. */
const refusal = (journalCode: JournalCode, extra: Args = {}) => ({ code: "conflict", message: `${journalCode}: refused`, detail: { journalCode, uncertain: false, ...extra } });

export function createReviewWriter(init: { head: string; rows: WireRow[]; hunks: WriterHunk[]; blocked?: BlockedHunk[] }) {
  const state = { head: init.head, generation: 10, rows: init.rows, hunks: init.hunks, blocked: init.blocked ?? [] };
  const decisions: Decision[] = [];
  const prepares: Args[] = [];
  /** Refusals the next decisions answer, in order. */
  const refuseDecisions: JournalCode[] = [];
  /** Applied reverts' transactions, and what each does to its hunk once committed. */
  const reverts = new Map<string, () => void>();

  /** Land every revert whose transaction the journal fake committed. */
  const landReverts = () => {
    for (const [txn, land] of reverts) {
      if (!journal.log.some((e) => e.op === "commit" && e.txn === txn)) continue;
      reverts.delete(txn);
      land();
    }
  };

  const wireHunk = (h: WriterHunk) => ({
    hunkId: h.hunkId,
    kind: "change",
    state: h.state,
    target: h.target,
    baseRange: { from: h.span.from, to: h.span.from },
    targetRange: h.span,
    reviewGen: String(h.reviewGen),
    span: h.span,
    editedSince: false,
  });

  const history = () => {
    landReverts();
    return {
      generation: String(state.generation),
      head: state.head,
      rows: state.rows,
      truncated: false,
      hunks: state.hunks.filter((h) => h.state !== "settled").map(wireHunk),
      blocked: state.blocked,
      degraded: false,
    };
  };

  /** Prepare `h`'s revert (or its revert of a revert) with the writer's patch. */
  async function applied(h: WriterHunk, fields: Args) {
    if (h.base === undefined) throw new Error("reviewWriterFake: an applied revert needs the hunk's base");
    const { hunkId: _h, expectedReviewGen: _g, ...rest } = fields;
    const p = await journal.prepareControlledWrite({ ...rest, tool: "revert" } as unknown as PrepareInput);
    const undo = h.state === "reverted";
    const { from, to } = h.span;
    const insert = undo ? h.wrote : h.base;
    const preimage = String(fields.preimage);
    const postimage = preimage.slice(0, from) + insert + preimage.slice(to);
    reverts.set(p.txn, () => {
      state.generation += 1;
      h.state = nextReviewState(undo ? "revertOfRevertApplied" : "revertApplied", h.state)!;
      h.reviewGen += 1;
      h.span = { from, to: from + insert.length };
    });
    const postimageHash = `sha256-${createHash("sha256").update(postimage, "utf8").digest("hex")}`;
    const response = { ...p, hunk: h.hunkId, reviewGen: fields.expectedReviewGen, from, to, insert, postimageHash };
    return { kind: "prepared", response };
  }

  function decide(args: Args) {
    const d = JSON.parse(String(args.payload)) as Decision;
    decisions.push(d);
    const code = refuseDecisions.shift();
    if (code) throw refusal(code);
    const targets = d.items.map((i) => state.hunks.find((h) => h.hunkId === i.hunkId));
    const fresh = d.expectedHead === state.head && targets.every((h, k) => h !== undefined && String(h.reviewGen) === d.items[k].expectedReviewGen);
    const next = targets.map((h) => (h ? nextReviewState(d.action as never, h.state) : undefined));
    if (!fresh || next.some((s) => s === undefined)) throw refusal("STALE_REVIEW");
    state.generation += 1;
    targets.forEach((h, k) => {
      h!.state = next[k]!;
      h!.reviewGen += 1;
    });
    return { generation: String(state.generation) };
  }

  const revert = (args: Args) =>
    answerPrepare(args, async (fields) => {
      prepares.push(fields);
      const h = state.hunks.find((x) => x.hunkId === fields.hunkId);
      if (!h || String(h.reviewGen) !== fields.expectedReviewGen) throw refusal("STALE_REVIEW");
      const inPlace = h.state === "reverted" ? h.base : h.wrote;
      if (String(fields.preimage).slice(h.span.from, h.span.to) === inPlace) return applied(h, fields);
      if (h.state === "conflicted") throw refusal("REVERT_REFUSED", { hunk: h.hunkId, reason: "conflicted", request: await notAdmitted(args) });
      state.generation += 1;
      h.state = "conflicted";
      h.reviewGen += 1;
      const response = { doc: "d", hunk: h.hunkId, action: "conflicted", reviewGen: String(h.reviewGen), generation: String(state.generation), baseline: null, head: state.head };
      return { kind: "decided", response };
    });

  async function handle(command: string, args?: unknown): Promise<unknown> {
    const a = (args ?? {}) as Args;
    if (command === "agent_journal_history") return history();
    if (command === "agent_journal_review_decide") return decide(a);
    if (command === "agent_journal_revert_prepare") return revert(a);
    return undefined;
  }

  return { state, decisions, prepares, refuseDecisions, handle };
}

/** The request echo a not-admitted prepare refusal carries. */
async function notAdmitted(args: Args) {
  const payload = String(args.payload);
  const requestId = (JSON.parse(payload) as Args).requestId;
  return { id: requestId, digest: createHash("sha256").update(payload, "utf8").digest("hex"), state: "notAdmitted" };
}
