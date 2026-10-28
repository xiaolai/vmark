// WI-AL0.9 — anchor block-provenance mutation run: the mutant list is required, reconciles with its counts, and every survivor states its equivalence
// WI-AL0.8 — txn writer mutation run: the mutant list is required and reconciles with its counts
/**
 * Pins the ONE mutant-list validator (alSpikeVerdictParts.mjs `mutantList`)
 * through both verdicts that use it. A mutation run is evidence only when it
 * can be checked: counts alone (`{ total: 1, unexplainedSurvivors: 0 }`)
 * prove nothing, so each run must list its mutants — each named once, each
 * killed one naming the tests that failed — and the list must agree with the
 * recorded totals. An anchor survivor passes only with a stated equivalence,
 * and the recorded unexplained count must be what the list shows.
 *
 * @coordinates-with scripts/lib/alSpikeVerdicts.mjs — anchorVerdict, txnVerdict
 * @coordinates-with scripts/lib/alSpikeVerdictParts.mjs — mutantList
 * @module scripts/lib/alSpikeVerdicts.mutants.test
 */
import { describe, expect, it } from "vitest";
import { anchorVerdict, txnVerdict } from "./alSpikeVerdicts.mjs";

const killed = (mutant) => ({ mutant, file: "a.ts", killed: true, failing: [`${mutant}-test`] });
const survivor = (mutant, equivalentBecause) => ({ mutant, file: "a.ts", killed: false, failing: [], ...(equivalentBecause === undefined ? {} : { equivalentBecause }) });
const PARTS = ["constructs", "serialization", "widen", "history", "lifecycle", "attach", "rebuild"];
const ANCHOR_MUTANTS = [killed("m1"), killed("m2"), survivor("m3", "identity already refuses it")];

function anchorDoc(mutants) {
  return {
    totals: { fixtures: 2, exact: 2, widened: 0, failed: 0 },
    blockProvenance: {
      totals: { cases: 8, pass: 8 },
      parts: {
        ...Object.fromEntries(PARTS.map((p) => [p, { cases: [{ pass: true }] }])),
        perf: { cases: [{ pass: true }], oneMiB: { observeUs: { n: 10, p95: 30 } } },
        mutants,
      },
    },
  };
}
const anchor = (mutants) => anchorVerdict(anchorDoc(mutants));
const anchorRun = (list, over = {}) => ({ total: list.length, killed: list.filter((m) => m.killed).length, unexplainedSurvivors: 0, mutants: list, ...over });

function txn(mutationChecks) {
  const doc = {
    schemaVersion: 2,
    gates: { testExit: 0, clippyExit: 0, measureExit: 0 },
    tests: { byArea: { provenance: { run: 2, passed: 2 } }, total: { run: 2, passed: 2 } },
    mutationChecks,
    measurements: { captureLatency: ["observe", "linearize"].map((op) => ({ sync: "full", op, provenance: true, liveSpans: 600, runs: 10, p50Ms: 5, p95Ms: 9 })) },
  };
  return txnVerdict(doc, { provenanceAreas: ["provenance"] });
}

describe("anchorVerdict — the block-provenance mutation run", () => {
  it("a listed run whose survivors all state an equivalence passes", () => {
    expect(anchor(anchorRun(ANCHOR_MUTANTS))).toEqual([]);
  });

  it("counts without a mutant list are refused", () => {
    expect(anchor({ total: 1, unexplainedSurvivors: 0 })).toContain("blockProvenance mutants needs integer total, killed and unexplainedSurvivors");
    expect(anchor({ total: 1, killed: 1, unexplainedSurvivors: 0 })).toContain("blockProvenance mutants lists no mutant");
  });

  it.each([
    ["a total that is not the list length", { total: 4 }, "blockProvenance mutants lists 3 mutant(s), 2 killed, but counts 4 total and 2 killed"],
    ["a killed count that is not the killed rows", { killed: 3 }, "blockProvenance mutants lists 3 mutant(s), 2 killed, but counts 3 total and 3 killed"],
  ])("%s is refused", (_name, over, problem) => {
    expect(anchor(anchorRun(ANCHOR_MUTANTS, over))).toContain(problem);
  });

  it.each([
    ["no stated equivalence", undefined],
    ["a blank equivalence", "  "],
    ["a non-string equivalence", true],
  ])("a survivor with %s is unexplained, whatever the recorded count says", (_name, why) => {
    const list = [killed("m1"), survivor("m9", why)];
    const problems = anchor(anchorRun(list));
    expect(problems).toContain('blockProvenance: 1 surviving mutant(s) without a stated equivalence (m9)');
    expect(problems).toContain("blockProvenance mutants records 0 unexplained survivor(s), but the list shows 1");
  });

  it("a recorded unexplained count the list does not show is refused", () => {
    expect(anchor(anchorRun(ANCHOR_MUTANTS, { unexplainedSurvivors: 2 }))).toContain("blockProvenance mutants records 2 unexplained survivor(s), but the list shows 0");
  });

  it("a mutant listed twice is refused", () => {
    const list = [killed("m1"), killed("m1"), survivor("m3", "equivalent")];
    expect(anchor(anchorRun(list))).toContain('blockProvenance mutants lists "a.ts: m1" 2 times');
  });

  it("the same mutant name in two files is two mutants", () => {
    const list = [killed("m1"), { ...killed("m1"), file: "b.ts" }];
    expect(anchor(anchorRun(list))).toEqual([]);
  });

  it.each([
    ["no failing tests", { ...killed("m1"), failing: [] }],
    ["failing that is not a list", { ...killed("m1"), failing: "t" }],
    ["a blank failing test name", { ...killed("m1"), failing: [""] }],
  ])("a killed mutant with %s is refused", (_name, row) => {
    expect(anchor(anchorRun([row]))).toContain('blockProvenance mutants: killed mutant "a.ts: m1" names no failing test');
  });

  it.each([
    ["a row that is not an object", 3],
    ["a row without a name", { killed: true, failing: ["t"] }],
    ["a row whose killed is not boolean", { mutant: "m1", killed: "yes", failing: ["t"] }],
  ])("%s is refused", (_name, row) => {
    expect(anchor({ total: 1, killed: 1, unexplainedSurvivors: 0, mutants: [row] })).toContain("blockProvenance mutants: 1 row(s) need a nonblank mutant name and a boolean killed");
  });

  it("an empty run is refused", () => {
    expect(anchor(anchorRun([]))).toContain("blockProvenance mutants records zero mutants");
  });
});

describe("txnVerdict — the writer mutation run", () => {
  const list = [killed("t1"), killed("t2")];
  it("a listed run that killed every mutant passes", () => {
    expect(txn({ killed: 2, survived: 0, mutants: list })).toEqual([]);
  });

  it("counts without a mutant list are refused", () => {
    expect(txn({ killed: 7, survived: 0 })).toContain("mutationChecks lists no mutant");
  });

  it("a list that disagrees with the counts is refused", () => {
    expect(txn({ killed: 3, survived: 0, mutants: list })).toContain("mutationChecks lists 2 mutant(s), 2 killed, but counts 3 total and 3 killed");
  });

  it("a killed mutant that names no failing test is refused", () => {
    expect(txn({ killed: 2, survived: 0, mutants: [killed("t1"), { ...killed("t2"), failing: [] }] })).toContain('mutationChecks: killed mutant "a.ts: t2" names no failing test');
  });

  it("a duplicated mutant is refused", () => {
    expect(txn({ killed: 2, survived: 0, mutants: [killed("t1"), killed("t1")] })).toContain('mutationChecks lists "a.ts: t1" 2 times');
  });
});
