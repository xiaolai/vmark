import { defineConfig } from "vitest/config";
import path from "path";
import { maxWorkers, testGlob } from "./vitest.shared";

/**
 * Gate self-test tier — the tests OF the lint gates, not of the app.
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
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: [testGlob("scripts"), testGlob(".claude/hooks")],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // These spawn child processes and then wait, so they are even further from
    // CPU-bound than the app tier. The ratio is INHERITED from the app tier's
    // sweep, not measured here — a subprocess burns CPU outside the worker
    // accounting that sweep was derived from, so it is a reasonable default
    // rather than an established optimum for this workload. See vitest.shared.ts.
    maxWorkers: maxWorkers(),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./src/shared"),
    },
  },
});
