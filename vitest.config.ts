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
        // Actuals at last ratchet (2026-07-04): st 93.63, br 90.33,
        // fn 93.35, ln 94.32.
        statements: 93.55,
        branches: 90.25,
        functions: 93.3,
        lines: 94.25,
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
