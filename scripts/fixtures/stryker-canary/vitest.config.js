// Canary fixture vitest config — resolves vitest from the repo root
// node_modules (upward resolution). `*.canary.js` keeps these tests invisible
// to the root suite; see ../../stryker-break-canary.test.mjs.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.canary.js"],
    environment: "node",
  },
});
