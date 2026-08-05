/**
 * `pnpm check:all` and CI's parallel groups must run the SAME set of gates.
 *
 * CI no longer runs `check:all` as one job. It runs the groups — `check:static`,
 * `test:coverage`, `check:servers`, `check:build` — as separate jobs so the
 * critical path is their max rather than their sum. That split introduces a
 * drift hole the moment it exists: append `pnpm lint:new-gate` directly to
 * `check:all` and it runs locally and in the pre-push hook, but NO CI job runs
 * it. The gate would look wired up, pass every local check, and be absent from
 * the only place that actually blocks a merge.
 *
 * So `check:all` may not contain steps of its own: it must be exactly the
 * composition of the groups CI runs. Adding a gate then has one correct home
 * (a group), and CI picks it up for free.
 *
 * @coordinates-with .github/workflows/ci.yml — fe-static / fe-test / fe-coverage / fe-servers / fe-build
 * @coordinates-with scripts/lib/packageScripts.mjs — transitive expansion
 * @module scripts/check-scripts-parity.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { invokedScripts } from "./lib/packageScripts.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
const ci = readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf8");

/** The groups CI runs as jobs. Each must appear verbatim in ci.yml. */
const CI_GROUPS = ["check:static", "test:coverage", "check:servers", "check:build"];

describe("check:all and CI run the same gates", () => {
  it("check:all is exactly the composition of the CI groups, in order", () => {
    const steps = pkg.scripts["check:all"].split("&&").map((s) => s.trim());
    expect(steps).toEqual(CI_GROUPS.map((g) => `pnpm ${g}`));
  });

  it("every gate check:all runs is reachable through some CI group", () => {
    const viaCheckAll = new Set(invokedScripts(pkg.scripts, "check:all"));
    const viaGroups = new Set(
      CI_GROUPS.flatMap((g) => [g, ...invokedScripts(pkg.scripts, g)]),
    );
    const orphans = [...viaCheckAll].filter((s) => !viaGroups.has(s));
    expect(orphans, `gates in check:all that no CI job runs: ${orphans.join(", ")}`).toEqual([]);
  });

  it("ci.yml actually invokes each group", () => {
    for (const group of CI_GROUPS) {
      // `test:coverage` runs sharded (`vitest run --coverage --shard=...`), so
      // accept either the script name or the sharded invocation it expands to.
      const present = ci.includes(`pnpm ${group}`) || (group === "test:coverage" && ci.includes("--shard="));
      expect(present, `ci.yml does not run ${group}`).toBe(true);
    }
  });

  it("the coverage gate is applied to the MERGED shard report", () => {
    // Sharding without a merge silently drops the thresholds: each shard would
    // measure a fraction of the suite and none would represent the whole.
    expect(ci).toContain("--merge-reports");
    expect(ci).toMatch(/--merge-reports[^\n]*--coverage|--coverage[^\n]*--merge-reports/);
  });
});
