/**
 * Purpose: the revert verdict's check that the deadline check itself is stable
 * (M3). Every worker timing in revert/results.json is judged by the caller-side
 * deadline check; a check that noise can flip (a late stand-in read as in time
 * once in thirty runs) makes those timings meaningless. run.mjs records the
 * self-test suite's runs — 30 alone and 10 with one busy loop per core — and
 * this refuses a record of any other suite, anything short of that (fewer busy
 * loops than the artifact's recorded `environment.cores` is not full load),
 * any failed run, or a record that ran no tests. The suite and the counts are
 * fixed here, never read from the artifact.
 *
 * @coordinates-with scripts/lib/alSpikeVerdicts.mjs — revertVerdict applies it
 * @coordinates-with scripts/check-al-spike-results.test.mjs — the verdict table
 * @module scripts/lib/alSpikeDeadlineSelfTest
 */

const SELF_TEST_SEQUENTIAL_RUNS = 30;
const SELF_TEST_LOADED_RUNS = 10;
/** The deadline self-test suite run.mjs records, relative to the revert spike. */
const SELF_TEST_SUITE = "test/deadlineCheck.probe.mjs";

const isCount = (v) => Number.isInteger(v) && v >= 0;

/** Every problem with the recorded `deadlineSelfTest`, run on `environment`; an empty list is a pass. */
export function deadlineSelfTestProblems(s, environment) {
  if (typeof s !== "object" || s === null || Array.isArray(s)) return ["no deadlineSelfTest record — the deadline check's stability was never measured"];
  const cores = environment?.cores;
  const checks = [
    [s.suite === SELF_TEST_SUITE, `deadline self-test record is of ${JSON.stringify(s.suite)}, not ${SELF_TEST_SUITE}`],
    [isCount(cores) && cores > 0, "no environment.cores recorded — the load the self-test ran under cannot be judged"],
    [isCount(s.sequentialRuns) && s.sequentialRuns >= SELF_TEST_SEQUENTIAL_RUNS,
      `deadline self-test ran ${s.sequentialRuns ?? "?"} times alone, fewer than ${SELF_TEST_SEQUENTIAL_RUNS}`],
    [isCount(s.loadedRuns) && s.loadedRuns >= SELF_TEST_LOADED_RUNS && isCount(s.loadWorkers) && s.loadWorkers > 0 && (!isCount(cores) || s.loadWorkers >= cores),
      `deadline self-test ran ${s.loadedRuns ?? "?"} times under ${s.loadWorkers ?? "?"} busy loops on ${cores ?? "?"} cores, fewer than ${SELF_TEST_LOADED_RUNS} under full load`],
    [isCount(s.testsPerRun) && s.testsPerRun > 0, "deadline self-test runs ran no tests"],
    [s.failedRuns === 0 && Array.isArray(s.failures) && s.failures.length === 0,
      `deadline self-test: ${s.failedRuns ?? "?"} failed runs (${Array.isArray(s.failures) ? s.failures.join("; ") : "failures not recorded"})`],
  ];
  return checks.filter(([ok]) => !ok).map(([, why]) => why);
}
