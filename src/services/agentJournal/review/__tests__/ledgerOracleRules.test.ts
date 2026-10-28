// WI-AL2.3 — the R24 ledger oracle's rules, case by case: the oracle's
// section rule equals CodeMirror's position mapping; a revert that would edit
// another live hunk is conflicted; the review decisions a non-applying revert
// records (pending → conflicted, then nothing; a reverted hunk found at its
// target, nothing); a revert of a revert restores exactly; and `decide`
// refuses a span that splits a surrogate pair, on the writer's own vectors.
// @vitest-environment node
import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { rng } from "./ledgerOracle/ledgerCorpus";
import { decide, hunksOf, initialItems, mapRevisions, revertOne, type Item } from "./ledgerOracle/ledgerEngine";
import type { LedgerHunk } from "./ledgerOracle/ledgerTypes";
import { TokenOracle } from "./ledgerOracle/tokenOracle";

/** One normal hunk at [p, q) and one deletion anchor at a, over `text`. */
function probe(text: string, p: number, q: number, a: number) {
  const hunks: LedgerHunk[] = [
    { fromA: p, toA: q, fromB: p, toB: q, baseText: "#", targetText: text.slice(p, q) },
    { fromA: a, toA: a + 1, fromB: a, toB: a, baseText: "#", targetText: "" },
  ];
  return new TokenOracle(text, hunks);
}

describe("the oracle's section rule is CodeMirror's", () => {
  it("every marker lands where ChangeSet.mapPos puts its affinity, over 2,000 random changes", () => {
    const r = rng(7);
    let checked = 0;
    for (let n = 0; n < 2000; n++) {
      const len = 1 + Math.floor(r() * 12);
      const text = "x".repeat(len);
      const p = Math.floor(r() * len);
      const q = p + 1 + Math.floor(r() * (len - p));
      const a = Math.floor(r() * (len + 1));
      const o = probe(text, p, q, a);
      const from = Math.floor(r() * (len + 1));
      const to = from + Math.floor(r() * (len - from + 1));
      const insert = "y".repeat(Math.floor(r() * 3));
      if (from === to && insert === "") continue;
      const cs = ChangeSet.of({ from, to, insert }, len);
      o.change(from, to, insert);
      // Rf and Lg are the region starts (right- and left-affine), Lt and Rg the ends.
      expect([o.pos(0, "Rf"), o.pos(0, "Lt"), o.pos(1, "Lg"), o.pos(1, "Rg")]).toEqual([
        cs.mapPos(p, 1),
        cs.mapPos(q, -1),
        cs.mapPos(a, -1),
        cs.mapPos(a, 1),
      ]);
      checked++;
    }
    expect(checked).toBeGreaterThan(1500);
  });
});

const setUp = (base: string, target: string, revisions: [number, number, string][][]) => {
  const hunks = hunksOf(base, target);
  const items = initialItems(hunks);
  const text = mapRevisions(items, target, revisions);
  const oracle = new TokenOracle(target, hunks);
  for (const rev of revisions) oracle.applyRevision(rev);
  return { items, text, oracle };
};

const copy = (it: Item) => ({ ...it });

describe("revert decisions the writer records", () => {
  it("a revert that would edit another live hunk is conflicted and moves nothing", () => {
    // B (an anchor at 2) inside A ("bc" at 1..3): a later agent revision's
    // hunk over an older one. One agent revision never stacks hunks, so the
    // fuzz cannot reach this rule; the writer's own case is review_op_table's.
    const target = "abcd";
    const hunks: LedgerHunk[] = [
      { fromA: 1, toA: 2, fromB: 1, toB: 3, baseText: "X", targetText: "bc" },
      { fromA: 2, toA: 3, fromB: 2, toB: 2, baseText: "Y", targetText: "" },
    ];
    const oracle = new TokenOracle(target, hunks);
    const items = initialItems(hunks);
    for (const i of [0, 1]) {
      expect(oracle.revertHits(i)).toBe(true);
      expect(oracle.revertOutcome(i)).toBe("conflicted");
      const other = copy(items[1 - i]);
      expect(revertOne(items[i], items, target)).toEqual({ status: "conflicted", text: target });
      expect(items[i].state).toBe("conflicted");
      expect(items[1 - i]).toEqual(other);
    }
  });

  it("an anchor on the edge of a replaced range is not hit: the revert applies", () => {
    // X deleted (an anchor at 1), Y → Q at 3..4; the human deletes the "bb"
    // between them, so the anchor sits on Q's start, outside Q.
    const { items, text, oracle } = setUp("aXbbYc", "abbQc", [[[1, 3, ""]]]);
    expect(text).toBe("aQc");
    expect(oracle.revertOutcome(1)).toBe("applied");
    expect(revertOne(items[1], items, text)).toMatchObject({ status: "applied", text: "aYc" });
    oracle.record(1, "applied");
    expect(oracle.text()).toBe("aYc");
    expect(oracle.revertOutcome(0)).toBe("applied");
    expect(revertOne(items[0], items, "aYc")).toMatchObject({ status: "applied", text: "aXYc" });
  });

  it("pending → conflicted is recorded once; a second conflict records nothing", () => {
    const { items, text } = setUp("aXc", "aYc", [[[1, 2, "Z"]]]);
    expect(revertOne(items[0], items, text)).toEqual({ status: "conflicted", text });
    expect(items[0].state).toBe("conflicted");
    const before = copy(items[0]);
    expect(revertOne(items[0], items, text)).toEqual({ status: "refused", text });
    expect(items[0]).toEqual(before);
  });

  it("a reverted hunk whose target is back in place records nothing", () => {
    const { items, text } = setUp("aXc", "aYc", []);
    const r = revertOne(items[0], items, text);
    expect(r).toMatchObject({ status: "applied", text: "aXc" });
    const retyped = mapRevisions(items, "aXc", [[[1, 2, "Y"]]]);
    expect(retyped).toBe("aYc");
    const before = copy(items[0]);
    expect(revertOne(items[0], items, retyped)).toEqual({ status: "refused", text: retyped });
    expect(items[0]).toEqual(before);
  });

  it("a revert of a revert restores the target and the span exactly", () => {
    const { items, text, oracle } = setUp("one\ntwo\n", "one!\ntwo\n", []);
    const r1 = revertOne(items[0], items, text);
    expect(r1).toMatchObject({ status: "applied", text: "one\ntwo\n" });
    oracle.revert(0);
    expect(items[0]).toMatchObject({ state: "reverted", from: 3, to: 3, growing: true });
    expect(oracle.region(0)).toMatchObject({ from: 3, to: 3, growing: true });
    const r2 = revertOne(items[0], items, r1.text);
    expect(r2).toMatchObject({ status: "applied", text: "one!\ntwo\n" });
    oracle.revert(0);
    expect(items[0]).toMatchObject({ state: "pending", from: 3, to: 4, growing: false });
    expect(oracle.region(0)).toMatchObject({ from: 3, to: 4, growing: false });
    expect(oracle.text()).toBe(r2.text);
  });
});

describe("decide refuses a span that splits a surrogate pair (the writer's vectors)", () => {
  const TEXT = "a\u{1F642}b";
  const span = (from: number, to: number, growing: boolean) => ({ from, to, growing });
  it.each([
    ["a normal span ending inside a pair", span(0, 2, false), "x", "zz"],
    ["an empty normal span inside a pair", span(2, 2, false), "", ""],
    ["an empty growing span inside a pair", span(2, 2, true), "", ""],
    ["an inverted span inside a pair", span(3, 2, false), "x", "y"],
  ] as const)("%s is an invariant", (_name, s, base, target) => {
    expect(() => decide(s, base, target, TEXT)).toThrow(/surrogate pair/);
  });
  it("spans on pair boundaries still decide", () => {
    expect(decide(span(1, 3, false), "\u{1F642}", "x", TEXT)).toEqual({ kind: "foundBase" });
    expect(decide(span(3, 1, false), "x", "y", TEXT)).toEqual({ kind: "conflicted" });
    expect(decide(span(1, 3, false), "x", "\u{1F642}", TEXT)).toEqual({ kind: "apply", from: 1, to: 3, insert: "x" });
    expect(decide(span(3, 3, true), "\u{4E2D}", "", TEXT)).toEqual({ kind: "apply", from: 3, to: 3, insert: "\u{4E2D}" });
  });
});
