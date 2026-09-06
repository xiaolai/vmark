import { defineConfig } from "vitest/config";
import { LIVENESS_TIMEOUT_MS, maxWorkers, sourceAliases, testGlob } from "./vitest.shared.ts";

/**
 * Gate and harness self-test tier — the tests OF the tooling, not of the app.
 *
 * `scripts/*.test.*` and `.claude/hooks/*.test.*` verify the gate scripts
 * themselves: each one spawns the gate as a SUBPROCESS against fixture trees
 * in a temp dir. That makes them process- and I/O-bound, and it makes them the
 * slowest files in the repo by a wide margin — measured in the combined suite:
 *
 *   34.3s  scripts/check-baseline-ratchet.test.mjs        (48 tests)
 *   27.4s  scripts/check-mock-boundaries.test.mjs         (24 tests)
 *   26.2s  scripts/depcruise-sensitivity.test.mjs         (13 tests)
 *   25.9s  scripts/check-shell-slots.test.ts              (18 tests)
 *   23.1s  scripts/check-plugin-store-coupling.test.ts    (34 tests)
 *   19.0s  scripts/check-deleted-names.test.mjs           (26 tests)
 *
 * against a ~100ms median for an app test file.
 *
 * They were sharing the app's config, which bought them a jsdom document and
 * `src/test/setup.ts` — React, Testing Library, axe-core and 148 KB of locale
 * JSON — per file, none of which a subprocess-spawning gate test can use. Here
 * they get `environment: "node"` and no setup at all.
 *
 * The split is about WHERE they run, not WHETHER. They moved from
 * `test:coverage` into `check:static` (`pnpm test:gates`), which CI runs as the
 * required `fe-static` job — so the `frontend` gate still blocks on every one
 * of them. `scripts/check-scripts-parity.test.mjs` asserts the four tiers (app,
 * gates, webkit, soak) PARTITION the test universe, repository-wide: a file
 * matched by none, or by two, fails — and it verifies that a required CI job
 * actually depends on the one running these. Without those assertions this
 * split would be one glob edit away from silently dropping a gate's self-test
 * while still reporting green.
 *
 * Coverage is deliberately not collected here. `vitest.config.ts` already
 * excluded `scripts/` from coverage before the split, and these tests exercise
 * their subject through a subprocess, so it never appeared in the in-process
 * coverage graph either way.
 *
 * `e2e/` joined this tier for the same two reasons the gates did: its helpers
 * are plain Node modules that must never see a jsdom document (they describe
 * the REAL webview, and a jsdom global is exactly the thing that could make a
 * broken probe look correct), and they have no use for `src/test/setup.ts`.
 * Only the harness's own pure helpers are unit-tested here — the journeys
 * themselves need a live app and are driven by `e2e/run-journeys.mjs`, never by
 * vitest. Before this, `e2e/` was owned by NO tier, so a test file added there
 * would have run nowhere; the partition check in
 * `scripts/check-scripts-parity.test.mjs` is what surfaced that, by failing.
 *
 * @coordinates-with vitest.config.ts — the app tier; all four tiers must partition
 * @coordinates-with scripts/check-scripts-parity.test.mjs — enforces the partition
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Same reasoning as the app tier (see vitest.config.ts): a timeout here is
    // a liveness bound, and every one of these tests waits on a real child
    // process, so 5000ms would measure machine load rather than correctness.
    //
    // 20_000 measured load too, and that is why this was 60_000. This tier is
    // also run by `pnpm check:predelta`, which puts it INSIDE an 8-way pool of
    // other gates (a full Vite build among them) on a 10-core box — measured
    // load average 68. `check-ipc-contract` (which parses every TS file in the
    // repo in a child process) and `clean-dev` both blew the 20s bound there,
    // and both finish in 11s wall for the two files together when run alone.
    // Raising the bound does not weaken what it detects: a child process that
    // has genuinely hung never returns, so it is still caught — just later.
    //
    // A lower default with per-file overrides for the slow ones was considered
    // and rejected on the measurements: UNLOADED, the slowest single test is
    // 16.5s (the real-Stryker canary), then 12.4s, then five in the 6–8s band.
    // Under predelta's contention those multiply, so a 25s default would sit
    // close enough to real durations to go flaky — trading a rare delay in
    // reporting a hang for intermittent red on healthy runs. The list of
    // exceptions would also have to be maintained, and its failure mode is the
    // same flake.
    //
    // ── 300_000, re-measured 2026-09-06 ──────────────────────────────────
    //
    // 60_000 was still derived the wrong way round. Every value above was
    // picked by measuring how long HEALTHY runs take and adding headroom —
    // which makes the bound a performance assertion wearing a liveness bound's
    // clothes: it fails on any machine slower than the one it was calibrated
    // on. A hang is a different thing entirely. It never returns, so it is
    // caught at ANY finite value, and the only price of a large one is how
    // long you wait to hear about it.
    //
    // So this is now set from "what is unambiguously a hang", not from healthy
    // durations. Measured on the calibration box while it was genuinely busy
    // (load average 105 across 31 sessions — other projects' language servers,
    // browsers, a second agent): `check-design-tokens.mjs` does 2.4s of CPU by
    // `--cpu-prof` and 4.7s wall when run alone, and the same test took 62s in
    // a serial tier run and blew past 60s in `check:all`. Other healthy tests
    // in the same run reached 267s. 300_000 is >100x the script's actual work.
    //
    // Two things this bound does NOT do, and neither is a reason to shrink it:
    //   - It cannot INTERRUPT a hung child. These tests call `execFileSync`,
    //     which blocks the worker thread, so vitest cannot pre-empt it; the
    //     timeout is observed only once the call returns. It is a REPORTING
    //     bound. Real enforcement would need `execFileSync(…, { timeout })` at
    //     each of the 73 spawn sites — worth doing, and not by nudging a number.
    //   - It does not measure performance. `pnpm bench` and the size gates do
    //     that, on purpose, where a regression is the signal rather than noise.
    //
    // Re-measure before revisiting; do not nudge. If you are tempted to lower
    // this because runs feel slow, the honest fix is fewer workers or a quieter
    // machine — not a bound that reports healthy work as broken.
    testTimeout: LIVENESS_TIMEOUT_MS,
    hookTimeout: LIVENESS_TIMEOUT_MS,
    include: [testGlob("scripts"), testGlob(".claude/hooks"), testGlob("e2e")],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // These spawn child processes and then wait. Swept here as well as in the
    // app tier, and the answer is that it does not matter: anything from 8 to
    // 24 lands inside the run-to-run variance, because the wall clock is set by
    // a few long subprocess-bound files rather than by pool throughput. Numbers
    // and method in vitest.shared.ts.
    maxWorkers: maxWorkers(),
  },
  resolve: {
    alias: sourceAliases(import.meta.dirname),
  },
});
