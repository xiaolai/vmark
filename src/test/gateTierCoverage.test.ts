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
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import gatesConfig from "../../vitest.gates.config";
import appConfig from "../../vitest.config";
import {
  LIVENESS_TIMEOUT_MS,
  MIN_WORKERS,
  OVERSUBSCRIPTION_RATIO,
  TEST_EXTENSIONS,
  maxWorkers,
} from "../../vitest.shared";
import { availableParallelism } from "node:os";

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

/**
 * Every tier's timeouts are LIVENESS bounds, and must not be re-derived from
 * how long healthy runs take.
 *
 * The distinction was written at the top of three separate configs and then
 * contradicted by the number underneath it. The app tier reached 20_000 by
 * measuring healthy tests that had failed at 5072ms and 6814ms; the gate tier
 * walked 5_000 -> 20_000 -> 60_000 the same way. A bound calibrated from
 * healthy durations is a performance assertion: it reports correct code as
 * broken on any machine slower than the one it was measured on, and the remedy
 * each time was to measure again and nudge. On 2026-09-06 both values failed
 * `check:all` on a box at load average 105.
 *
 * A hang never returns, so it is caught at ANY finite value. This pins the
 * floor so the ratchet cannot run backwards, and asserts every tier uses the
 * SHARED constant rather than a copy — the copies are what drifted.
 *
 * It lives in the app tier so it still runs when the gate tier is broken.
 */
describe("tier timeouts are liveness bounds", () => {
  it("exposes one shared constant, not a number per config", () => {
    expect(LIVENESS_TIMEOUT_MS).toBeGreaterThanOrEqual(300_000);
  });

  it.each([
    ["gate tier", gatesConfig],
    ["app tier", appConfig],
  ])("%s uses the shared bound for tests and hooks", (_label, config) => {
    const resolved = typeof config === "function" ? config : config;
    const test = (resolved as { test?: { testTimeout?: number; hookTimeout?: number } }).test;
    expect(
      test?.testTimeout,
      "Lowering this makes healthy runs fail on a loaded machine. If runs feel " +
        "slow, reduce workers or quieten the machine — do not shrink a liveness bound.",
    ).toBe(LIVENESS_TIMEOUT_MS);
    // Hooks spawn the same work the tests do, so a lower hook bound
    // reintroduces the identical flake through the back door.
    expect(test?.hookTimeout).toBe(LIVENESS_TIMEOUT_MS);
  });

  // The server packages are separate vitest projects that copied the same
  // rationale and the same 20_000. They import the constant now; this asserts
  // they did not go back to a literal.
  it.each([
    "server/content/vitest.config.ts",
    "server/mcp/vitest.config.ts",
  ])("%s references the shared constant rather than a literal", (relative) => {
    const source = readFileSync(path.join(REPO, relative), "utf8");
    expect(source).toContain("LIVENESS_TIMEOUT_MS");
    expect(source, "a numeric literal here is how the three copies drifted").not.toMatch(
      /(test|hook)Timeout:\s*\d/,
    );
  });
});

/**
 * The worker pool is sized from FREE cores, not from how many exist.
 *
 * `availableParallelism()` reports core count and never load. On a dedicated
 * runner those agree; on a developer machine they do not, and sizing from the
 * larger number oversubscribes exactly when the machine can least afford it.
 * That is what made every wall-clock bound here need raising — app tier
 * 5s→20s, gate tier 5s→20s→60s→300s, pathological 60s→180s→300s — each a
 * symptom of the same pool.
 *
 * Measured 2026-09-06 on one commit, changing only this number: 16 workers
 * failed 3 test files (a DIFFERENT three each run — whichever landed on a
 * starved worker); 3 workers passed 1644 files and 38074 tests with every
 * bound untouched.
 *
 * These assertions pin the shape rather than a value, because the value is
 * supposed to move with the machine.
 */
describe("worker sizing accounts for machine load", () => {
  it("never exceeds what the cores could deliver if idle", () => {
    const ceiling = Math.max(
      MIN_WORKERS,
      Math.round(availableParallelism() * OVERSUBSCRIPTION_RATIO),
    );
    // One-sided by construction: load can only ever shrink the pool. A result
    // above the idle ceiling would mean load was being ADDED somewhere.
    expect(maxWorkers()).toBeLessThanOrEqual(ceiling);
  });

  it("never serialises the suite outright", () => {
    // A wait-dominated suite pinned to one worker is its own kind of failure,
    // which is why the floor is a named constant rather than a bare Math.max.
    expect(maxWorkers()).toBeGreaterThanOrEqual(MIN_WORKERS);
  });

  it("reads load rather than assuming an idle machine", () => {
    // The regression this guards is reverting to `availableParallelism() *
    // RATIO`, which is silent: it only misbehaves on a busy machine, and the
    // symptom is unrelated tests failing on wall clocks.
    const source = readFileSync(path.join(REPO, "vitest.shared.ts"), "utf8");
    expect(source).toContain("loadavg");
    expect(
      source,
      "sizing straight from availableParallelism() ignores the load already on those cores",
    ).not.toMatch(/Math\.round\(availableParallelism\(\) \* OVERSUBSCRIPTION_RATIO\)/);
  });
});
