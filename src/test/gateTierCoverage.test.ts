// @vitest-environment node
/**
 * Purpose: assert the GATE tier still collects every gate self-test — from the
 *   APP tier, which is a different config and a different CI job.
 *
 * `scripts/check-scripts-parity.test.mjs` owns the partition check, and it is
 * itself discovered through the same `scripts/**` glob it polices. That is
 * circular in one specific way: narrow the gate tier's include and the guard
 * stops being collected too, so the assertion that would have caught the change
 * simply never runs. Nothing fails. `pnpm test:gates` reports success on a
 * smaller set, which is exactly the shape of failure the guard exists to make
 * impossible.
 *
 * This file closes that loop from outside. It lives in `src/`, so it is
 * collected by `vitest.config.ts` and runs in CI's `fe-test` job — a different
 * config, a different job, and unaffected by any edit to the gate tier's globs.
 * The two guards now cover each other rather than themselves.
 *
 * @coordinates-with vitest.gates.config.ts — the tier whose coverage this pins
 * @coordinates-with scripts/check-scripts-parity.test.mjs — the guard this backstops
 * @module test/gateTierCoverage
 */
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import gatesConfig from "../../vitest.gates.config";
import { TEST_EXTENSIONS } from "../../vitest.shared";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEST_FILE_RE = /\.(test|spec)\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/;

/** Every gate self-test on disk, by the roots the gate tier is responsible for. */
function gateTestsOnDisk(): string[] {
  const found: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && TEST_FILE_RE.test(entry.name)) found.push(child);
    }
  };
  walk("scripts");
  walk(".claude/hooks");
  return found.sort();
}

describe("the gate tier still collects every gate self-test", () => {
  it("covers both gate roots", () => {
    const includes = gatesConfig.test?.include ?? [];
    for (const root of ["scripts", ".claude/hooks"]) {
      expect(
        includes.some((p) => p.startsWith(`${root}/`)),
        `vitest.gates.config.ts no longer includes "${root}/" — every gate ` +
          `self-test under it has silently stopped running, including the ` +
          `partition guard that would otherwise have caught this`,
      ).toBe(true);
    }
  });

  it("uses the shared extension set, so no suffix is quietly dropped", () => {
    for (const pattern of gatesConfig.test?.include ?? []) {
      expect(
        pattern.endsWith(TEST_EXTENSIONS),
        `gate include "${pattern}" does not use the shared extension set — a ` +
          `gate self-test with an unlisted suffix would not run`,
      ).toBe(true);
    }
  });

  it("there are gate self-tests to collect, and a plausible number of them", () => {
    // A lower bound, not an exact count: this file must not need editing every
    // time a gate gains a test. It catches the collapse-to-near-zero case,
    // which is what a broken glob or a moved directory actually looks like.
    const onDisk = gateTestsOnDisk();
    expect(onDisk.length).toBeGreaterThan(20);
    expect(onDisk).toContain("scripts/check-scripts-parity.test.mjs");
  });
});
