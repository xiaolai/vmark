import { availableParallelism } from "node:os";
import { resolve } from "node:path";

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
 * **The knee is the APP tier's.** The gate tier was swept separately
 * (58 files, 1,112 tests, same 10-core box) and has NO knee to find:
 *
 *   batch A   8 → 48s    16 → 44s    24 → 57s
 *   batch B  12 → 68s    16 → 71s    20 → 66s
 *
 * The same setting measured 44s and 71s in the two batches, so run-to-run
 * variance exceeds every difference between settings. The reason is in the
 * per-file distribution: one test takes 16.5s (the real-Stryker canary), the
 * next 12.4s (check-ipc-contract against the whole repo), and a handful more
 * 6–8s — all of them waiting on child processes. A pool wide enough to hold
 * those few in parallel is wide enough, and 8 already is.
 *
 * So the shared ratio costs this tier nothing, and there is no separate number
 * worth maintaining. Do not "tune" it here on a single run — a single run
 * cannot resolve a difference smaller than 60%.
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

/**
 * The `@` / `@shared` source aliases, for every root Vite and Vitest config.
 *
 * This block was written out verbatim in all five of them. They agreed today,
 * which is exactly the state in which a duplicate is cheapest to leave and most
 * expensive to have left: moving `src/shared` would need five identical edits,
 * and missing one fails only in whichever tier was missed.
 *
 * Despite the module's name this also serves `vite.config.ts` — the app build is
 * not a vitest tier, but it resolves the same two aliases against the same root,
 * and a second shared-config module to hold one function would be worse.
 *
 * @param rootDir the config's own directory (`import.meta.dirname`)
 */
export function sourceAliases(rootDir: string): Record<string, string> {
  return {
    "@": resolve(rootDir, "./src"),
    "@shared": resolve(rootDir, "./src/shared"),
  };
}
