import { expect } from "vitest";

/**
 * Purpose: one way to assert "this finished in bounded time" without turning
 *   machine load into a test failure.
 *
 * Five tests measured elapsed wall clock with `performance.now()` and asserted
 * a tight threshold inline. That conflates two different claims:
 *
 *   - **Liveness** — the algorithm terminates instead of blowing up
 *     quadratically or hanging. This is a correctness property, it is what the
 *     assertions were really protecting, and it holds on any machine.
 *   - **Performance** — it finishes within N ms. This is a budget, and on a
 *     loaded box it measures the box.
 *
 * Asserting the budget on every run makes the suite fail for reasons that have
 * nothing to do with the code. `escapeUnclosedMathFences` measured 6779ms
 * against a 5000ms inline threshold during a `check:all` run — not a
 * regression, just a busy machine, and the same run passed the two assertions
 * that actually describe the behaviour. The project already reached this
 * conclusion twice: `markdownPipeline/__tests__/performance.test.ts` is
 * `PERF=1`-gated for exactly this reason ("timing thresholds flake under CPU
 * contention"), and `pathological/pathological.test.ts` moved to a killable
 * child process because "in-process `performance.now()` assertions are
 * CI-variance flakes".
 *
 * So: the generous liveness bound is checked ALWAYS — a genuine hang or
 * quadratic blowup still fails the suite, for everyone, by default. The tight
 * budget is checked only under `PERF=1`, where the machine is presumed quiet.
 * Neither claim is dropped; they are just no longer pretending to be one claim.
 *
 * Keep `livenessMs` comfortably under `testTimeout` (20s) so this assertion
 * reports the failure — a bare "test timed out" names nothing.
 *
 * @module test/timeBudget
 */

/** True when the caller has asked for tight timing budgets to be enforced.
 *  Deliberately NOT exported — nothing outside this module needs to branch on
 *  it, and an exported-but-unused symbol is dead code the knip gate counts. */
const PERF_ENABLED = process.env.PERF === "1";

export interface TimeBudget {
  /** Tight budget, enforced only under `PERF=1`. */
  budgetMs: number;
  /** Generous bound, always enforced — catches unbounded work, not slowness. */
  livenessMs: number;
  /** What was being timed, for the failure message. */
  label: string;
}

/**
 * Assert an elapsed duration against a liveness bound always, and a performance
 * budget only when `PERF=1`.
 */
export function expectBoundedTime(elapsedMs: number, budget: TimeBudget): void {
  const { budgetMs, livenessMs, label } = budget;

  expect(
    elapsedMs,
    `${label}: took ${Math.round(elapsedMs)}ms, past the ${livenessMs}ms LIVENESS ` +
      `bound. This is not "the machine was busy" territory — it indicates ` +
      `unbounded or superlinear work.`,
  ).toBeLessThan(livenessMs);

  if (PERF_ENABLED) {
    expect(
      elapsedMs,
      `${label}: took ${Math.round(elapsedMs)}ms against a ${budgetMs}ms budget (PERF=1).`,
    ).toBeLessThan(budgetMs);
  }
}
