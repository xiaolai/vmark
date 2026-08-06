import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import path from "path";

/**
 * Browser test tier — the terminal input gate path cannot be verified in jsdom
 * (Q1: jsdom drains microtasks as [L1,L2,microtask] not [L1,microtask,L2]; Q3:
 * src/test/setup.ts globally mocks @xterm/xterm). These tests run in REAL WebKit
 * against the REAL xterm.js, dispatching recorded event sequences and asserting
 * exact bytes reaching a recording fake PTY.
 *
 * Deliberately NOT wired into `check:all` (jsdom): run with `pnpm test:browser`.
 * No `src/test/setup.ts` — that mock is exactly what this tier exists to avoid.
 */
export default defineConfig({
  test: {
    globals: true,
    // `*.webkit.test.ts` = real-WebKit tier. NOT `*.browser.test.ts` — that
    // suffix already means "tests for the embedded-browser FEATURE" and those
    // are ordinary jsdom tests.
    include: ["src/**/*.webkit.test.{ts,tsx}"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "webkit" }],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./src/shared"),
    },
  },
});
