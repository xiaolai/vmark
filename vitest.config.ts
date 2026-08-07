import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { maxWorkers, suffixGlob, testGlob } from "./vitest.shared";

/**
 * Worker count, extension list and the measurements behind them live in
 * `vitest.shared.ts` — one definition for every tier, because the gate tier
 * carried a verbatim copy of this expression and copies drift.
 *
 * Two things about the pool that belong here, at the app tier:
 *
 * Widening it RAISES the rate of an existing flake class — tests that wait on a
 * lazily-imported heavy module graph under a wall-clock budget.
 * `Editor.test.tsx` failed ~1 run in 5 at the DEFAULT width before any tuning,
 * because its budget was measuring machine contention while Vite transformed
 * Tiptap rather than whether the surface arrives. Those budgets now come from
 * `src/test/waitBudget.ts`, sized against the ~10.7s that import actually
 * costs. If a NEW test of that shape starts flaking, fix its bound — do not
 * narrow this pool and call it fixed.
 *
 * And it is `test.maxWorkers`, NOT `test.poolOptions.forks.maxForks`: Vitest 4
 * REMOVED `poolOptions` and made those settings top-level. The nested spelling
 * still parses, prints one deprecation line, and is then IGNORED — the suite
 * runs at the default width and every test passes, so the config looks applied
 * and the timing quietly does not change. Verify a change here against the wall
 * clock, never against a green run.
 */

/**
 * `environment: "jsdom"` below is the DEFAULT, not the rule.
 *
 * Constructing a jsdom document costs ~3.3s of worker time per file, and it was
 * 60% of this suite's total worker time — paid by every file, including the
 * majority that never touch the DOM. Most app-tier files now carry a
 * `// @vitest-environment node` docblock on line 1 and skip it — at the time of
 * writing 834 of 1,439, though the exact figures are not worth chasing here;
 * `grep -rl '^// @vitest-environment node' src | wc -l` is the current answer.
 *
 * That set was determined by MEASUREMENT, not by inspection: the whole tier was
 * run under `--environment=node` and every file that passed was marked. A
 * "looks pure" heuristic is not good enough — a directory-level sample of 289
 * files that read as DOM-free still had 28 that genuinely needed a document.
 *
 * Effect on the full coverage run: environment 5215.88s -> 1903.53s (-63%),
 * wall 832.14s -> 535.67s (-35.6%), with coverage unmoved (94.26/90.61/93.75/
 * 95.11 against 94.26/90.62/93.75/95.12) — which is the check that matters,
 * because a changed environment could otherwise take a different branch.
 *
 * To mark a NEW test file: add the docblock, run it, and let it fail if it
 * needs a document. Do not mark one by eye. `src/test/nodeEnvironmentDirective
 * .test.ts` asserts the docblock is still honoured at all — if Vitest ever
 * stops reading it, every marked file falls back to jsdom silently and green.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    maxWorkers: maxWorkers(),
    // A test timeout is a LIVENESS bound — "this hung" — not a performance
    // assertion. Vitest's 5000ms default is sized for an isolated unit test,
    // but this suite runs ~1450 files across every core at once, so for any
    // test doing real I/O, a dynamic import, or a heavy render, 5000ms of wall
    // clock measures how busy the machine is rather than whether the code is
    // correct. Four separate tests failed that way in one session — at 5072ms,
    // 6814ms and ~1000ms waits — each passing in isolation in a few seconds.
    //
    // Raising it cannot mask a correctness bug: a wrong result still fails
    // immediately, and only a genuine hang takes longer to report. Actual
    // performance budgets stay explicit and separate (see
    // `fullwidthScaling.test.ts`), where they belong.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // App tier only. The gate self-tests — `scripts/**` and `.claude/hooks/**`
    // — moved to `vitest.gates.config.ts` (`pnpm test:gates`, inside
    // `check:static`, so CI's required `frontend` job still blocks on them).
    // They spawn subprocesses and can use neither jsdom nor `setup.ts`, and
    // they are the slowest files in the repo; see that config for the numbers.
    //
    // All FOUR tiers (this, gates, webkit, soak) must PARTITION the test
    // universe — a file matched by none would silently stop running while
    // everything still reports green. `scripts/check-scripts-parity.test.mjs`
    // asserts exactly that, repository-wide and in both directions, by
    // importing every config rather than restating their globs.
    // `website/.vitepress` is named LITERALLY rather than reached by a `**`
    // from `website/`: a leading-dot segment is not traversed by a plain `**`.
    // It holds `cjkSpacing.test.ts`, a real committed test that ran NOWHERE —
    // `website/` has no test script and no vitest config, so nothing collected
    // it. The repository-wide partition check surfaced it; running it here is
    // the fix, and its coverage is excluded below for the same reason
    // `scripts/` is: the website is a separate deployable, not part of the
    // app's coverage ratchet.
    include: [testGlob("src"), testGlob("website/.vitepress")],
    // `*.webkit.test.ts` runs in the real-WebKit tier (vitest.browser.config.ts),
    // not jsdom — it needs real xterm + real keyboard input. See `pnpm test:browser`.
    // (`*.browser.test.ts` is NOT excluded — that suffix means the embedded-browser
    // feature and those are ordinary jsdom tests.)
    // `*.soak.test.ts` is the scheduled/local soak tier (vitest.soak.config.ts,
    // `pnpm test:soak`) — runtime downloads and long-running sweeps that must
    // never gate a PR (ADR-6 of the markdown-testing plan).
    // The suffix excludes cover the SAME extension set as the include above
    // (via `suffixGlob`). They used to list only `{ts,tsx}` against an include
    // of eight extensions, so a `*.webkit.test.mjs` would have been collected
    // here and run under jsdom — the single thing that tier exists to avoid —
    // while still looking correctly owned to the partition check, because it
    // was owned, just by the wrong tier.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      suffixGlob("src", "webkit"),
      suffixGlob("src", "soak"),
    ],
    server: {
      deps: {
        // The @actions/* packages ship JSON imports without
        // `with { type: "json" }` import attributes; Node's strict ESM
        // (≥22) rejects them. Inlining forces Vite to transform the
        // modules, which handles JSON natively. See
        // dev-docs/grills/gha-workflow/spike-a-parser.md.
        inline: [
          "@actions/workflow-parser",
          "@actions/languageservice",
          "@actions/expressions",
        ],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      exclude: [
        "node_modules/",
        "src/test/",
        // Build/dev tooling. Scripts are still unit-tested — by the GATE
        // TIER (`vitest.gates.config.ts`, `pnpm test:gates`), not by the
        // include glob above, which is `src/**` only since the split. Their
        // behaviour is guarded by explicit test assertions,
        // not by a coverage %. Coverage-gating one-off build scripts only
        // reintroduces threshold fragility (e.g. an uncovered realGit wrapper).
        "scripts/",
        // Separate deployable — see the include note above.
        "website/",
        "**/*.d.ts",
        "**/*.config.*",
        // Invariant: every src/**/index.ts is a pure re-export barrel (or a
        // documented data-only exception) — enforced by
        // scripts/check-index-barrels.mjs (`pnpm lint:barrels`, in check:all).
        // Logic added to an index.ts fails that gate, so nothing real can
        // escape the coverage ratchet through this glob.
        "**/index.ts",
        "**/*.css",
        "src/assets/**",
      ],
      thresholds: {
        // Ratchet-only floors: each value is the measured actual minus a
        // ~0.05 pp flake buffer. When coverage rises, raise the floor to the
        // new actual minus the buffer; relaxing requires a written
        // justification in the commit message. The per-relaxation history
        // that used to live here (2026-04 → 2026-07, ~290 lines) is in git
        // history. Per-file gaps: pnpm test:coverage, then coverage/index.html.
        // Actuals at last ratchet (2026-07-30): st 93.97, br 90.42,
        // fn 93.45, ln 94.77. The branches buffer is ~0.07 pp (not 0.05):
        // the suite had drifted to EXACTLY the old floor and CI's ±2-3
        // branch run-to-run variance flaked unrelated PRs red.
        statements: 93.9,
        branches: 90.35,
        functions: 93.4,
        lines: 94.7,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./src/shared"),
    },
  },
});
