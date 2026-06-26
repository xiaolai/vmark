import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Node-safe markdown-pipeline boundary (ADR-4). The production CI bundle
      // vendors these alias-free plugin files into the content-server package;
      // here we resolve them straight from the app source so tests and the
      // editor stay in lockstep (single source of truth, no fork).
      "@vmark/markdown-plugins": fileURLToPath(
        new URL("../src/utils/markdownPipeline/nodeSafe.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.bench.ts", "src/cli.ts", "src/index.ts"],
      // Ratcheted gate (grill H3). Seeded just below measured coverage; raise
      // as M13 adds direct tests for watch/extract/resolve/search.
      thresholds: {
        statements: 85,
        branches: 70,
        functions: 85,
        lines: 88,
      },
    },
  },
});
