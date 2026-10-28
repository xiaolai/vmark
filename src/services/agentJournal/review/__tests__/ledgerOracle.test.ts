// WI-AL2.3 — the R24 ledger oracle. Agent hunks come from the production
// canonical diff; human revisions are explicit operations (minimal and
// non-minimum histories, bounded uncertified breaks, snapshots) composed by
// the production provenance accumulator; spans map through the production
// span mapping; the revert decision is the writer's, ported and pinned to the
// shared `revertGate` vectors. An identity oracle that never reads the mapper
// says where each hunk is and what its revert must produce.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import golden from "@/test/fixtures/agentJournal/provenance.json";
import { TokenOracle } from "./ledgerOracle/tokenOracle";
import { humanHistory, segmentedScenario, type ScenarioShape } from "./ledgerOracle/ledgerCorpus";
import { gate, hunksOf, initialItems, mapRevisions, type GateItem } from "./ledgerOracle/ledgerEngine";
import { checkLedgerCase, type LedgerTally, type RevertOrder } from "./ledgerOracle/ledgerCheck";

const CASES = 120;

const SHAPES: Record<string, ScenarioShape> = {
  repetitiveSeparated: { lines: 40, alphabet: ["a", "b", "c"], agentEdits: 3, humanEdits: 3, gap: 2 },
  repetitiveAdjacent: { lines: 40, alphabet: ["a", "b", "c"], agentEdits: 3, humanEdits: 3, gap: 1 },
  proseAdjacent: { bytes: 4096, agentEdits: 5, humanEdits: 5, gap: 1 },
  shortRunsWithEmptyLines: { lines: 12, alphabet: ["a", "a", "b", ""], agentEdits: 3, humanEdits: 3, gap: 1 },
  ab8: { lines: 8, alphabet: ["a", "b"], agentEdits: 2, humanEdits: 2, gap: 1 },
};

const TALLIED = ["hunks", "applied", "reapplied", "resolved", "refused", "hitConflicts", "wrong", "spanMismatch", "requiredMissed", "nontrivial"] as const;

interface Fuzz extends LedgerTally {
  snapshotTwins: number;
  snapshotApplied: number;
  bounded: number;
  wrongSeeds: string[];
}

function fuzz(): Fuzz {
  const f: Fuzz = {
    hunks: 0, applied: 0, reapplied: 0, resolved: 0, refused: 0, hitConflicts: 0, wrong: 0, spanMismatch: 0, requiredMissed: 0,
    nontrivial: 0, refusedBefore: [], refusedAfter: [], snapshotTwins: 0, snapshotApplied: 0, bounded: 0, wrongSeeds: [],
  };
  for (const [name, shape] of Object.entries(SHAPES)) {
    for (const [mixed, order] of [[false, "latestFirst"], [true, "latestFirst"], [true, "earliestFirst"]] as const) {
      for (let seed = 1; seed <= CASES; seed++) {
        const s = segmentedScenario({ ...shape, seed });
        if (s.base === s.target) continue;
        const h = humanHistory(s, seed, { mixed });
        if (h.revisions.some((rev) => rev.some((op) => !Array.isArray(op)))) f.bounded++;
        const t = checkLedgerCase({ base: s.base, target: s.target, revisions: h.revisions }, { order: order as RevertOrder });
        for (const k of TALLIED) f[k] += t[k];
        f.refusedBefore.push(...t.refusedBefore);
        f.refusedAfter.push(...t.refusedAfter);
        if ((t.wrong || t.spanMismatch || t.requiredMissed) && f.wrongSeeds.length < 5) f.wrongSeeds.push(`${name}/${mixed ? "mixed" : "minimal"}/${order}/${seed}`);
        if (h.text === s.target) continue;
        // The same final text with no history: a whole-document break.
        const twin = checkLedgerCase({ base: s.base, target: s.target, revisions: [h.text] });
        f.snapshotTwins++;
        f.snapshotApplied += twin.applied + twin.resolved;
        f.wrong += twin.wrong;
      }
    }
  }
  return f;
}

describe("ledger oracle (R24)", () => {
  it("the oracle fuzz finds zero wrong reverts, zero span mismatches and nonzero successes, and every refusal leaves the state unchanged", () => {
    const f = fuzz();
    // The failing seeds first: the counts alone do not say where to look.
    expect(f.wrongSeeds).toEqual([]);
    expect(f.wrong).toBe(0);
    expect(f.spanMismatch).toBe(0);
    expect(f.requiredMissed).toBe(0);
    const successes = f.applied;
    expect(successes).toBeGreaterThan(0);
    expect(f.nontrivial, "reverts that moved or were edited around").toBeGreaterThan(0);
    expect(f.reapplied, "reverts of a revert").toBeGreaterThan(0);
    expect(f.resolved, "human saves and reverts that found the base").toBeGreaterThan(0);
    expect(f.refusedBefore.length).toBeGreaterThan(0);
    expect(f.refusedAfter).toEqual(f.refusedBefore);
    expect(f.bounded, "histories with an uncertified range").toBeGreaterThan(0);
    expect(f.snapshotTwins).toBeGreaterThan(0);
    expect(f.snapshotApplied).toBe(0);
  });

  it("follows the history, not the text: one final text, two histories, two oracle regions", () => {
    const base = "aZb";
    const target = "ab";
    const regions = [[[1, 2, ""]], [[0, 1, ""], [0, 1, "a"]]].map((ops) => {
      const revisions = [ops as [number, number, string][]];
      const hunks = hunksOf(base, target);
      const oracle = new TokenOracle(target, hunks);
      for (const rev of revisions) oracle.applyRevision(rev);
      const items = initialItems(hunks);
      mapRevisions(items, target, revisions);
      const reg = oracle.region(0);
      expect([items[0].from, items[0].to]).toEqual([reg.from, reg.to]);
      return reg.from;
    });
    expect(regions[0]).not.toBe(regions[1]);
  });

  it("the oracle catches a wrong mapper: the engine fed one history, the oracle the other", () => {
    const t = checkLedgerCase(
      { base: "aZb", target: "ab", revisions: [[[1, 2, ""]]] },
      { oracleRevisions: [[[0, 1, ""], [0, 1, "a"]]] },
    );
    expect(t.spanMismatch).toBeGreaterThan(0);
  });

  it("an uncertified range refuses the hunks it reaches and maps the rest exactly", () => {
    const base = "one\ntwo\nthree\nfour\n";
    const target = "one X\ntwo\nthree Y\nfour\n";
    // After the "> " prefix the hunk " Y" sits at 17..19; the break replaces 16..18, reaching it.
    const t = checkLedgerCase({ base, target, revisions: [[[0, 0, "> "], { uncertified: [16, 18, "UU"] }]] }, { passes: 1 });
    expect(t.wrong).toBe(0);
    expect(t.spanMismatch).toBe(0);
    expect(t.applied).toBe(1);
    expect(t.refused).toBe(1);
    expect(t.text).toBe("> one\ntwo\nthreUUY\nfour\n");
  });
});

describe("revert gate (steps 1–2) equals the writer's on the shared vectors", () => {
  const toItem = (h: (typeof golden.revertGate)[number]["hunk"]): GateItem => ({
    id: h.hunkId,
    state: h.state as GateItem["state"],
    from: h.range.from,
    to: h.range.to,
    growing: h.growing,
    block: h.block,
  });
  it.each(golden.revertGate.map((v) => [v.name, v] as const))("%s", (_name, v) => {
    const item = toItem(v.hunk);
    const got = gate(item, [item, ...v.others.map(toItem)]);
    expect(got).toEqual(v.expect);
  });
});
