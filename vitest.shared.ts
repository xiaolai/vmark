import { availableParallelism } from "node:os";

/**
 * Settings shared by every vitest tier, so the tiers cannot drift apart.
 *
 * @module vitest.shared
 */

/**
 * Deliberate OVERSUBSCRIPTION of the worker pool.
 *
 * The app suite is worker-slot-bound, not CPU-bound. Measured at the default
 * settings (10-core Apple Silicon, 1465 files, 35,466 tests): 890s wall for
 * 7,354 worker-seconds — 8.26 concurrent workers — while using only 2.46 of 10
 * cores. Workers sit occupied but OFF-CPU, because ~86% of their time is
 * per-file fixed cost (jsdom construction, setup, import) rather than running
 * assertions. Vitest's default of `availableParallelism() - 1` sizes the pool
 * for CPU-bound work, so most of the machine goes unused.
 *
 * Sweep, one clean run each, all with IDENTICAL results (1463 passed /
 * 2 skipped files, 35,383 passed / 82 skipped / 1 expected fail, exit 0):
 *
 *   9 (default)   890.05s     —
 *  12             693.55s   -22.1%
 *  16             620.58s   -30.3%   <- knee
 *  20             702.25s   -21.1%   past the knee, contention wins
 *
 * 16 on 10 cores is the 1.6x below. A RATIO, not the literal 16, because CI
 * runners have 4 cores and a hardcoded 16 would oversubscribe them 4x.
 *
 * If this needs re-tuning, re-run the sweep rather than nudging the number:
 * past the knee the wall clock gets WORSE, so a guess in the wrong direction is
 * a silent regression that still reports green.
 *
 * **The ratio is measured for the APP tier only.** The gate tier
 * (`vitest.gates.config.ts`) spawns child processes that burn CPU *outside* the
 * worker accounting this ratio was derived from, so for that tier it is an
 * inherited default, not an established optimum. It is shared because one
 * definition that is honest about its provenance beats two copies that drift —
 * not because the gate tier was benchmarked.
 */
export const OVERSUBSCRIPTION_RATIO = 1.6;

/**
 * The floor exists so a 1- or 2-core container does not serialise the suite
 * outright; on such a machine the effective ratio is 4x or 2x rather than 1.6x.
 * That is intentional for a wait-dominated workload, and it is why the floor is
 * stated here rather than buried in a `Math.max`.
 */
export const MIN_WORKERS = 4;

/** Worker count for a tier, from the machine's parallelism. */
export function maxWorkers(): number {
  return Math.max(MIN_WORKERS, Math.round(availableParallelism() * OVERSUBSCRIPTION_RATIO));
}

/**
 * The file extensions every tier's include/exclude patterns must agree on.
 *
 * Shared because they drifted: the app tier's `include` accepted eight
 * extensions while its webkit and soak `exclude`s listed only `ts,tsx`. A
 * `*.webkit.test.mjs` would therefore have been collected by the app tier under
 * jsdom — the one environment that tier exists to avoid — and the partition
 * check would still have called it correctly owned, because it WAS owned, just
 * by the wrong tier.
 */
export const TEST_EXTENSIONS = "{js,mjs,cjs,ts,mts,cts,jsx,tsx}";

/** Glob for every test file under a root, e.g. `testGlob("src")`. */
export function testGlob(root: string): string {
  return `${root}/**/*.{test,spec}.${TEST_EXTENSIONS}`;
}

/** Glob for a named sub-tier's files, e.g. `suffixGlob("src", "webkit")`. */
export function suffixGlob(root: string, suffix: string): string {
  return `${root}/**/*.${suffix}.test.${TEST_EXTENSIONS}`;
}
