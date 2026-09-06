import { availableParallelism, loadavg } from "node:os";
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

/**
 * Worker count for a tier, from the machine's FREE parallelism.
 *
 * `availableParallelism()` reports how many cores exist, never how many are
 * idle. On a dedicated CI runner those are the same number and the ratio above
 * is exactly what was measured. On a developer machine they are not: this box
 * was at load average 41 across 31 sessions — other projects' language
 * servers, browsers, a second agent — while the pool still sized itself for a
 * quiet 10-core machine and started 16 workers on top.
 *
 * That oversubscription is the reason every wall-clock bound in this repo has
 * needed raising, repeatedly: the app tier 5s→20s, the gate tier
 * 5s→20s→60s→300s, the pathological ceiling 60s→180s→300s. Each was a symptom.
 * Measured 2026-09-06, same commit, same machine, only this number changed:
 *
 *   16 workers → 3 test files failed (a different three on each run:
 *                agentSnapshot/ariaParity once, WorkflowEngineSlot/CopyButton
 *                the next — whichever landed on a starved worker)
 *    3 workers → 1644 files, 38074 tests, 0 failures, and 1-minute load
 *                dropped from 41 to 14
 *
 * So the pool is sized from cores MINUS the load already on them. The clamp is
 * deliberately one-sided: it can only ever shrink the pool below the measured
 * ratio, and only when the machine is genuinely busy, so a quiet runner
 * (load ≈ 0) gets precisely the previous behaviour. `MIN_WORKERS` still floors
 * it, because a wait-dominated suite serialised outright is its own failure.
 *
 * `loadavg()[0]` is the 1-minute figure — responsive enough to see a busy
 * machine, smoothed enough not to react to one spike. It returns 0 on
 * platforms that do not implement it (Windows), which yields the unchanged
 * ratio rather than a wrong guess.
 */
export function maxWorkers(): number {
  const cores = availableParallelism();
  const busy = loadavg()[0];
  // Never below 1 core's worth, never above the cores that exist.
  const free = Math.min(cores, Math.max(1, cores - busy));
  return Math.max(MIN_WORKERS, Math.round(free * OVERSUBSCRIPTION_RATIO));
}

/**
 * The liveness bound every tier uses, in milliseconds.
 *
 * A test timeout answers "did this HANG", not "was this fast". That
 * distinction has been written at the top of three separate configs and then
 * contradicted by the number underneath it: the app tier reached 20_000 by
 * measuring healthy tests that had failed at 5072ms and 6814ms, and the gate
 * tier walked 5_000 -> 20_000 -> 60_000 the same way. Calibrating a liveness
 * bound from healthy durations makes it a PERFORMANCE ASSERTION — it reports
 * correct code as broken on any machine slower than the one it was measured
 * on, and the remedy each time is to measure again and nudge.
 *
 * A hang never returns, so it is caught at ANY finite value. The only price of
 * a large one is how long you wait to hear about it. So this is set from what
 * is unambiguously a hang, not from how long healthy work takes.
 *
 * Measured 2026-09-06 on the 10-core calibration box while it was genuinely
 * busy (load average 105 across 31 sessions — other projects' language
 * servers, browsers, a second agent): `check-design-tokens.mjs` does 2.4s of
 * CPU by `--cpu-prof` and 4.7s wall alone, yet its test blew a 60s bound;
 * healthy gate tests in the same run reached 267s, and app-tier jsdom tests
 * that pass in ~5s alone reached 20.5s. 300_000 is over 100x the real work in
 * every one of those cases.
 *
 * ONE constant rather than a number per config, for the reason this file
 * already exists: the previous values were copies, and the copies drifted.
 * `vitest.soak.config.ts` keeps its own larger bound — that tier is
 * long-running by design, so its number is not a copy of this one.
 *
 * Pinned by `src/test/gateTierCoverage.test.ts`, which runs in the APP tier so
 * it still reports when the gate tier is the broken thing.
 */
export const LIVENESS_TIMEOUT_MS = 300_000;

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
