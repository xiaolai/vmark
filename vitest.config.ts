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
        // Actuals at last ratchet (2026-07-02): st 93.17, br 89.99,
        // fn 92.92, ln 93.85.
        statements: 93.1,
        branches: 89.9,
        functions: 92.85,
        lines: 93.8,
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
