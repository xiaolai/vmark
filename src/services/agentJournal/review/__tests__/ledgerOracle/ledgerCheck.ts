/**
 * Ledger check (test support) — runs one case through the engine and the
 * identity oracle side by side and compares them after every step.
 *
 * After the human saves: the engine's capture resolutions equal the oracle's,
 * and every span equals the oracle's region (blocked exactly where the oracle
 * says broken). Then pass 1 reverts every unresolved hunk and pass 2 reverts
 * every hunk pass 1 reverted again (revert of a revert). At each revert the
 * engine's outcome equals the oracle's `revertOutcome`; an applied revert
 * writes at the oracle's region and leaves exactly the oracle's text, and
 * every span still equals the oracle's region; a revert that does not apply
 * leaves the text, and everything but that hunk's recorded state, unchanged.
 */

import type { Revision } from "./ledgerTypes";
import { hunksOf, initialItems, mapRevisions, revertOne, type Item } from "./ledgerEngine";
import { TokenOracle } from "./tokenOracle";

export type RevertOrder = "latestFirst" | "earliestFirst";

/** At a tie the anchor goes first either way: the collision rule decides it. */
const ORDERS: Record<RevertOrder, (x: Item, y: Item) => number> = {
  latestFirst: (x, y) => y.from - x.from || Number(y.growing) - Number(x.growing),
  earliestFirst: (x, y) => x.from - y.from || Number(y.growing) - Number(x.growing),
};

export interface LedgerTally {
  hunks: number;
  applied: number;
  /** Pass 2: reverts of a revert that applied. */
  reapplied: number;
  resolved: number;
  refused: number;
  /** Conflicts the oracle attributes to the revert touching another hunk. */
  hitConflicts: number;
  /** A success the oracle disagrees with, a wrong text, or a refusal that changed anything. */
  wrong: number;
  /** A span not at the oracle's region, or blocked where the oracle is not broken (or the reverse). */
  spanMismatch: number;
  /** A revert or resolution the oracle requires that the engine refused. */
  requiredMissed: number;
  /** Applied reverts that moved or were edited around. */
  nontrivial: number;
  refusedBefore: string[];
  refusedAfter: string[];
}

export interface LedgerCase {
  base: string;
  target: string;
  revisions: readonly Revision[];
}

const zero = (): LedgerTally => ({
  hunks: 0, applied: 0, reapplied: 0, resolved: 0, refused: 0, hitConflicts: 0, wrong: 0, spanMismatch: 0,
  requiredMissed: 0, nontrivial: 0, refusedBefore: [], refusedAfter: [],
});

/** Text and every item's state, except the state of `skip` (a refusal may record one decision for it). */
const digest = (text: string, items: readonly Item[], skip?: Item) =>
  JSON.stringify([text, items.map((it) => [it.id, it === skip ? null : it.state, it.from, it.to, it.growing, it.block, it.edited])]);

function spanMismatches(items: readonly Item[], oracle: TokenOracle): number {
  let n = 0;
  items.forEach((it, i) => {
    const broken = oracle.snapshot || oracle.affected.has(i);
    if (broken !== (it.block !== null)) n++;
    else if (!broken) {
      const r = oracle.region(i);
      if (r.from !== it.from || r.to !== it.to || r.growing !== it.growing) n++;
    }
  });
  return n;
}

/**
 * `oracleRevisions` feeds the oracle another history, for the test that the
 * check notices a wrong mapper; `passes: 1` stops before the reverts of a
 * revert, for a case that names its expected text.
 */
export function checkLedgerCase(
  { base, target, revisions }: LedgerCase,
  { oracleRevisions = revisions, order = "latestFirst" as RevertOrder, passes = 2 as 1 | 2 } = {},
): LedgerTally & { text: string } {
  const t = zero();
  const hunks = hunksOf(base, target);
  const items = initialItems(hunks);
  let current = mapRevisions(items, target, revisions);
  const oracle = new TokenOracle(target, hunks);
  for (const rev of oracleRevisions) oracle.applyRevision(rev);
  if (oracleRevisions === revisions && !oracle.snapshot && oracle.text() !== current) throw new Error("oracle and history disagree on the text");
  t.hunks = hunks.length;
  const human = revisions.some((rev) => rev.length > 0);
  items.forEach((it, i) => {
    const engine = it.state === "resolvedByHumanEdit";
    if (engine) t.resolved++;
    if (engine && !oracle.resolved.has(i)) t.wrong++;
    if (!engine && oracle.resolved.has(i)) t.requiredMissed++;
  });
  t.spanMismatch += spanMismatches(items, oracle);

  const step = (it: Item, pass: 1 | 2) => {
    const i = items.indexOf(it);
    const want = oracle.revertOutcome(i);
    const before = current;
    const edited = it.edited;
    const digestBefore = digest(current, items, it);
    const r = revertOne(it, items, current);
    if (r.status !== want) {
      const engineSucceeded = r.status === "applied" || r.status === "foundBase";
      if (engineSucceeded || want === "ambiguous" || want === "conflicted" || want === "refused") t.wrong++;
      else t.requiredMissed++;
    }
    if (want === "conflicted" && oracle.revertHits(i)) t.hitConflicts++;
    // The oracle moves only by its own outcome, so a disagreement cannot steer it.
    if (want === "applied" && r.status === "applied" && r.from !== oracle.region(i).from) t.wrong++;
    oracle.record(i, want);
    if (r.status === "applied") {
      current = r.text;
      if (pass === 1) t.applied++;
      else t.reapplied++;
      if (oracle.text() !== current) t.wrong++;
      if (human && (r.from !== it.hunk.fromB || edited)) t.nontrivial++;
      t.spanMismatch += spanMismatches(items, oracle);
      return;
    }
    if (r.text !== before) t.wrong++;
    if (r.status === "foundBase") t.resolved++;
    else t.refused++;
    t.refusedBefore.push(digestBefore);
    t.refusedAfter.push(digest(current, items, it));
  };

  const sorted = (pick: (it: Item) => boolean) => items.filter(pick).sort(ORDERS[order]);
  for (const it of sorted((it) => it.state !== "resolvedByHumanEdit")) step(it, 1);
  if (passes === 2) for (const it of sorted((it) => it.state === "reverted")) step(it, 2);
  if (!oracle.snapshot && oracle.text() !== current) t.wrong++;
  return { ...t, text: current };
}
