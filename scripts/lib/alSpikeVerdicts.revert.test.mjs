// WI-AL0.4 — the revert deadline verdict by its numbers: mode counts reconcile with the timing samples, and every normal run found its hunks in every run
/**
 * Pins `revertVerdict`'s two deadline paths against artifacts the main
 * self-test (scripts/check-al-spike-results.test.mjs) does not build:
 *   - every mode tally accounts for exactly its timing samples — a one-sample
 *     run cannot carry 1,998 recorded modes, and a pathological run cannot
 *     carry more modes than samples;
 *   - the consecutive-kill record holds one kill sample and one follow-up
 *     sample per recorded timeout;
 *   - a normal 40/600-edit run found its hunks in EVERY run: the fewest hunks
 *     any run found (`minHunkCount`) is at least the edits, not only the most;
 *   - the realistic 40-edit call after each kill found all 40 hunks too
 *     (`afterKillMinHunkCount`): an exact mode alone does not show the diff
 *     the promoted spare returned was the full one.
 *
 * @coordinates-with scripts/lib/alSpikeVerdicts.mjs — revertVerdict
 * @coordinates-with dev-docs/grills/agent-edit-ledger/revert/lib/probePerf.mjs — records minHunkCount and the mode tallies
 * @module scripts/lib/alSpikeVerdicts.revert.test
 */
import { describe, expect, it } from "vitest";
import { revertVerdict } from "./alSpikeVerdicts.mjs";

const SOUND = { cases: 10, hunks: 20, applied: 18, nontrivial: 12, wrong: 0, spanMismatch: 0, requiredMissed: 0, snapshotApplied: 0 };
const STABLE = { suite: "test/deadlineCheck.probe.mjs", sequentialRuns: 30, loadedRuns: 10, loadWorkers: 10, testsPerRun: 37, failedRuns: 0, failures: [] };
const wall = (p95, n = 20) => ({ n, p50: p95 - 1, p95, max: p95 + 0.5 });
const normal = (hunks, n = 20) => ({ wall: wall(20, n), modes: { exact: n }, minHunkCount: hunks, maxHunkCount: hunks });
/** Passes by the worker path only (the native pathological run was never cut short). */
const WORKER = {
  workerDeadline1MB: { edits40: normal(40), edits600: normal(600) },
  workerTerminationPathological: { wall: wall(182), modes: { coarse: 20 } },
  consecutiveTimeouts: { timeouts: 10, respawns: 10, killWall: wall(182, 10), afterKillWall: wall(16, 10), afterKillModes: { exact: 10 }, afterKillMinHunkCount: 40, afterKillMaxHunkCount: 40 },
  nativeBudgetPathological: { wall: wall(150, 8), modes: { exact: 8 } },
  nativeBudgetRealistic40: normal(40, 8),
};
/** Passes by the native path only (the worker's pathological run is over the deadline). */
const NATIVE = { ...WORKER, workerTerminationPathological: { wall: wall(250), modes: { coarse: 20 } }, nativeBudgetPathological: { wall: wall(150, 8), modes: { "coarse-native": 3, exact: 5 } } };

const verdict = (perf) => revertVerdict({
  recommendation: { library: "diff-match-patch" },
  deadlineSelfTest: STABLE,
  environment: { cores: 10 },
  libraries: { dmp: { package: "diff-match-patch", fixtures: { pass: 3, total: 3 }, perf, revertOracleFuzz: { minimal: { summary: SOUND }, mixed: { summary: SOUND } }, revertSeedSweep: { summary: SOUND } } },
});
/** The one problem a path-failing perf yields, which names both paths' reasons. */
const neither = (perf) => {
  const problems = verdict(perf);
  expect(problems).toHaveLength(1);
  return problems[0];
};
const worker = (patch) => ({ ...WORKER, ...patch });
const native = (patch) => ({ ...NATIVE, ...patch });

describe("revertVerdict — the worker path, by its numbers", () => {
  it("a consistent worker-path record passes", () => {
    expect(verdict(WORKER)).toEqual([]);
  });

  it.each([
    ["40", "edits40", 40, { minHunkCount: 39 }, "1 MB, 40 edits: the fewest hunks a run found is 39 of 40"],
    ["40", "edits40", 40, { minHunkCount: undefined }, "1 MB, 40 edits: the fewest hunks a run found is ? of 40"],
    ["600", "edits600", 600, { minHunkCount: 12 }, "1 MB, 600 edits: the fewest hunks a run found is 12 of 600"],
    ["600", "edits600", 600, { minHunkCount: 601, maxHunkCount: 600 }, "1 MB, 600 edits: the fewest hunks a run found (601) exceeds the most (600)"],
  ])("a %s-edit run (%s, %i hunks) recording %j is refused", (_e, key, hunks, over, problem) => {
    const perf = worker({ workerDeadline1MB: { ...WORKER.workerDeadline1MB, [key]: { ...normal(hunks), ...over } } });
    expect(neither(perf)).toContain(problem);
  });

  it.each([
    ["more modes than samples", { coarse: 20, exact: 3 }, "pathological: modes {\"coarse\":20,\"exact\":3} account for 23 of 20 runs"],
    ["a non-integer mode count", { coarse: 20, exact: 0.5 }, "pathological: modes {\"coarse\":20,\"exact\":0.5} account for ? of 20 runs"],
  ])("a pathological record with %s is refused", (_name, modes, problem) => {
    expect(neither(worker({ workerTerminationPathological: { wall: wall(182), modes } }))).toContain(problem);
  });

  it.each([
    ["kill samples", { killWall: wall(182, 9) }, "consecutive kill: 9 samples for 10 timeouts"],
    ["follow-up samples", { afterKillWall: wall(16, 11), afterKillModes: { exact: 11 } }, "call after a kill: 11 samples for 10 timeouts"],
  ])("consecutive timeouts whose %s do not match the timeouts are refused", (_name, over, problem) => {
    expect(neither(worker({ consecutiveTimeouts: { ...WORKER.consecutiveTimeouts, ...over } }))).toContain(problem);
  });

  it.each([
    ["no post-kill hunk evidence", { afterKillMinHunkCount: undefined, afterKillMaxHunkCount: undefined }, "call after a kill: the fewest hunks a run found is ? of 40"],
    ["a post-kill call that found fewer hunks", { afterKillMinHunkCount: 1 }, "call after a kill: the fewest hunks a run found is 1 of 40"],
    ["a fewest count over the most", { afterKillMinHunkCount: 41, afterKillMaxHunkCount: 40 }, "call after a kill: the fewest hunks a run found (41) exceeds the most (40)"],
  ])("consecutive timeouts with %s are refused", (_name, over, problem) => {
    expect(neither(worker({ consecutiveTimeouts: { ...WORKER.consecutiveTimeouts, ...over } }))).toContain(problem);
  });
});

describe("revertVerdict — the native path, by its numbers", () => {
  it("a consistent native-path record passes", () => {
    expect(verdict(NATIVE)).toEqual([]);
  });

  it("a one-sample pathological run carrying 1,998 recorded modes is refused", () => {
    const perf = native({ nativeBudgetPathological: { wall: wall(150, 1), modes: { "coarse-native": 1998 } } });
    expect(neither(perf)).toContain('native pathological: modes {"coarse-native":1998} account for 1998 of 1 runs');
  });

  it("a realistic native run whose fewest hunks fall short is refused", () => {
    const perf = native({ nativeBudgetRealistic40: { ...normal(40, 8), minHunkCount: 30 } });
    expect(neither(perf)).toContain("native realistic, 40 edits: the fewest hunks a run found is 30 of 40");
  });

  it("a realistic native run with no samples is refused", () => {
    const perf = native({ nativeBudgetRealistic40: { modes: { exact: 8 }, minHunkCount: 40, maxHunkCount: 40 } });
    expect(neither(perf)).toContain("native realistic, 40 edits: no timings recorded");
  });
});
