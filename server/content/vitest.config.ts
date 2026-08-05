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
        new URL("../../src/utils/markdownPipeline/nodeSafe.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Liveness bound, not a performance assertion — see the root
    // `vitest.config.ts`. These tests bind real sockets and drive a real file
    // watcher, and the live-socket case timed out at 5072ms against the 5000ms
    // default purely because the machine was busy.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.bench.ts", "src/cli.ts", "src/index.ts"],
      // Ratcheted gate (grill H3). Thresholds sit just below measured
      // coverage — raise them when coverage rises, never lower them.
      // (cli.ts/index.ts stay excluded as MINIMAL process wrappers; all CLI
      // behavior lives in cliMain.ts, which IS covered.)
      thresholds: {
        statements: 85,
        branches: 70,
        functions: 85,
        lines: 88,
      },
    },
  },
});
