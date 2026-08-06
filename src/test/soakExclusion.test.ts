/**
 * WI-5.1 DoD pin — soak files are PROVABLY absent from the default vitest
 * include. `*.soak.test.ts` matched the default `*.test.ts` include until
 * the plan's ADR-6 split; this test fails if the exclusion is ever dropped,
 * which would silently pull runtime-download soaks into `pnpm check:all`.
 *
 * @module test/soakExclusion.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("soak tier separation", () => {
  it("the default config excludes *.soak.test.*", () => {
    const config = readFileSync(resolve(repoRoot, "vitest.config.ts"), "utf8");
    expect(config).toContain('src/**/*.soak.test.{ts,tsx}');
  });

  it("the soak config includes ONLY *.soak.test.*", () => {
    const config = readFileSync(resolve(repoRoot, "vitest.soak.config.ts"), "utf8");
    expect(config).toContain('include: ["src/**/*.soak.test.{ts,tsx}"]');
  });
});
