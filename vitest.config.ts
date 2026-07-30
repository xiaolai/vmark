import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "scripts/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      // TDD-guard hooks are governance-critical and were previously untested.
      // They run as subprocesses in their own tests (stdin JSON → exit code),
      // so nothing here is imported into the in-process coverage graph.
      ".claude/hooks/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
    // `*.webkit.test.ts` runs in the real-WebKit tier (vitest.browser.config.ts),
    // not jsdom — it needs real xterm + real keyboard input. See `pnpm test:browser`.
    // (`*.browser.test.ts` is NOT excluded — that suffix means the embedded-browser
    // feature and those are ordinary jsdom tests.)
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.webkit.test.{ts,tsx}"],
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
        // Build/dev tooling. Scripts are still unit-tested (see the include
        // glob above) — their behaviour is guarded by explicit test assertions,
        // not by a coverage %. Coverage-gating one-off build scripts only
        // reintroduces threshold fragility (e.g. an uncovered realGit wrapper).
        "scripts/",
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
