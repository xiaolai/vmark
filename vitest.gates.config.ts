import { defineConfig } from "vitest/config";
import { maxWorkers, sourceAliases, testGlob } from "./vitest.shared.ts";

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
    // 20_000 measured load too, and that is why this is 60_000. This tier is
    // also run by `pnpm check:predelta`, which puts it INSIDE an 8-way pool of
    // other gates (a full Vite build among them) on a 10-core box — measured
    // load average 68. `check-ipc-contract` (which parses every TS file in the
    // repo in a child process) and `clean-dev` both blew the 20s bound there,
    // and both finish in 11s wall for the two files together when run alone.
    // Raising the bound does not weaken what it detects: a child process that
    // has genuinely hung never returns, so it is still caught — just 40s later.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: [testGlob("scripts"), testGlob(".claude/hooks"), testGlob("e2e")],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // These spawn child processes and then wait, so they are even further from
    // CPU-bound than the app tier. The ratio is INHERITED from the app tier's
    // sweep, not measured here — a subprocess burns CPU outside the worker
    // accounting that sweep was derived from, so it is a reasonable default
    // rather than an established optimum for this workload. See vitest.shared.ts.
    maxWorkers: maxWorkers(),
  },
  resolve: {
    alias: sourceAliases(import.meta.dirname),
  },
});
