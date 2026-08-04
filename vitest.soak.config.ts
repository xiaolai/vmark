import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Soak tier (WI-5.1, plan ADR-6) — a NAMED tier, not an env-var mode:
 * runtime-download corpora (Pro Git, OSS-Fuzz, editing-traces) and
 * long-running sweeps live in `*.soak.test.ts`, which the default config
 * EXCLUDES. Run with `pnpm test:soak`; scheduled by
 * `.github/workflows/soak.yml`, which also re-runs the ordinary fuzz and
 * pathological suites at raised scales (FUZZ_RUNS / PATHOLOGICAL_SCALE).
 *
 * Node environment, long timeouts: a soak that hangs is a visibly red/timed-
 * out scheduled job, which is exactly the failure surface ADR-6 asks for.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.soak.test.{ts,tsx}"],
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./src/shared"),
    },
  },
});
