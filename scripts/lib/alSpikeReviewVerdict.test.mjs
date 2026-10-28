// WI-AL0.6 — the review spike's run verdict: no skipped test anywhere, and the totals are the sum of the per-probe rows
/**
 * Pins `reviewVerdict`'s run section against artifacts the main self-test
 * (scripts/check-al-spike-results.test.mjs) does not build: a probe whose
 * acceptance tests were skipped is not a passing probe, a skipped count must
 * be recorded (integer) in every row and in the totals, and the totals must
 * equal the sum of the rows, so a hand-edited total cannot hide a row.
 *
 * @coordinates-with scripts/lib/alSpikeReviewVerdict.mjs — the verdict under test
 * @module scripts/lib/alSpikeReviewVerdict.test
 */
import { describe, expect, it } from "vitest";
import { reviewVerdict } from "./alSpikeReviewVerdict.mjs";

const SOUND = { cases: 10, hunks: 20, applied: 18, nontrivial: 12, wrong: 0, spanMismatch: 0, requiredMissed: 0, snapshotApplied: 0 };
const PROBES = ["ambiguousRevert.probe.ts", "barriers.probe.ts", "budgets.probe.ts", "sourceProvenance.probe.ts"];
const ROW = { passed: 3, failed: 0, skipped: 0 };
const MEASUREMENTS = {
  sourceProvenance: { transactions: 10, spansChecked: 20, kinds: { undo: 1, redo: 1, compose: 1, netZero: 1 } },
  budgets: { cap: 4, session: { observeCpuMs: { n: 5, p95: 0.1 }, captureCpuMs: { n: 5, p95: 0.1 } }, nearCap: { peakEntries: 4, observeCpuMs: { n: 5, p95: 0.1 }, observeCpuMsNearCap: { n: 5, p95: 0.1 }, captureCpuMs: { n: 5, p95: 0.1 } } },
  barriers: { capOverflow: { cap: 4, ops: 4 } },
  ambiguousRevert: {
    ledgerOracleFuzz: { byShapeAndMode: { "ab8/minimal": SOUND } },
    regressions: { r: { status: "applied", text: "a", expected: "a", ambiguous: 0, wrong: 0, spanMismatch: 0, requiredMissed: 0 } },
  },
};

/** A passing review document whose rows are `rows` (default: every probe at ROW) and whose totals are their sum unless given. */
function doc({ rows, totals } = {}) {
  const testsPerArea = rows ?? Object.fromEntries(PROBES.map((f) => [f, ROW]));
  const sum = (k) => Object.values(testsPerArea).reduce((n, r) => n + (Number.isInteger(r?.[k]) ? r[k] : 0), 0);
  return { status: "pass", totals: totals ?? { passed: sum("passed"), failed: sum("failed"), skipped: sum("skipped") }, testsPerArea, measurements: MEASUREMENTS };
}
const verdict = (d) => reviewVerdict(d, { reviewProbes: PROBES });
const rowsWith = (file, row) => ({ ...Object.fromEntries(PROBES.map((f) => [f, ROW])), [file]: row });

describe("reviewVerdict — skipped tests and reconciled totals", () => {
  it("a passing document with no skipped test passes", () => {
    expect(verdict(doc())).toEqual([]);
  });

  it("a probe with one passing test and its acceptance tests skipped is refused", () => {
    const problems = verdict(doc({ rows: rowsWith("budgets.probe.ts", { passed: 1, failed: 0, skipped: 5 }) }));
    expect(problems).toContain("budgets.probe.ts: 5 skipped");
    expect(problems).toContain("totals: 5 skipped");
  });

  it("an extra row (not a required probe) that skipped is refused too", () => {
    const rows = { ...Object.fromEntries(PROBES.map((f) => [f, ROW])), "extra.probe.ts": { passed: 2, failed: 0, skipped: 1 } };
    expect(verdict(doc({ rows }))).toContain("extra.probe.ts: 1 skipped");
  });

  it.each([
    ["a row without a skipped count", { passed: 3, failed: 0 }, "budgets.probe.ts needs integer passed, failed and skipped"],
    ["a row with a fractional skipped count", { passed: 3, failed: 0, skipped: 0.5 }, "budgets.probe.ts needs integer passed, failed and skipped"],
    ["a row that is not an object", 7, "budgets.probe.ts needs integer passed, failed and skipped"],
  ])("%s is refused", (_name, row, problem) => {
    expect(verdict(doc({ rows: rowsWith("budgets.probe.ts", row), totals: { passed: 12, failed: 0, skipped: 0 } }))).toContain(problem);
  });

  it("totals without a skipped count are refused", () => {
    expect(verdict(doc({ totals: { passed: 12, failed: 0 } }))).toContain("totals needs integer passed, failed and skipped");
  });

  it("totals that skipped while every row is clean are refused, and do not reconcile", () => {
    const problems = verdict(doc({ totals: { passed: 12, failed: 0, skipped: 2 } }));
    expect(problems).toContain("totals: 2 skipped");
    expect(problems).toContain("totals.skipped 2 ≠ sum of testsPerArea 0");
  });

  it.each([
    ["passed", { passed: 99, failed: 0, skipped: 0 }, "totals.passed 99 ≠ sum of testsPerArea 12"],
    ["passed (short)", { passed: 1, failed: 0, skipped: 0 }, "totals.passed 1 ≠ sum of testsPerArea 12"],
  ])("totals whose %s is not the sum of the rows are refused", (_k, totals, problem) => {
    expect(verdict(doc({ totals }))).toContain(problem);
  });

  it("a failed row must show in the totals' failed count", () => {
    const problems = verdict(doc({ rows: rowsWith("budgets.probe.ts", { passed: 3, failed: 1, skipped: 0 }), totals: { passed: 12, failed: 0, skipped: 0 } }));
    expect(problems).toContain("totals.failed 0 ≠ sum of testsPerArea 1");
  });
});
