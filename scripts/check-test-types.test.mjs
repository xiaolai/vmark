// Self-test for scripts/check-test-types.mjs.
//
// The gate is only worth having if it fails on the drift it exists for, so
// every direction is exercised against synthetic input rather than against the
// repository's own (agreeing) baseline. `measure()` shells out to tsc and is
// deliberately not exercised here — the end-to-end case at the bottom covers
// it once, and running tsc over 404k lines per assertion would make this the
// slowest file in the repo.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDiagnostics, compare, BASELINE_PATH, PROJECT } from "./check-test-types.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("parseDiagnostics", () => {
  it("counts one error per diagnostic line, grouped by file", () => {
    const out = [
      "src/a.test.ts(1,1): error TS2322: Type 'string' is not assignable.",
      "src/a.test.ts(9,4): error TS2345: Argument of type 'x'.",
      "src/b.test.ts(3,2): error TS2339: Property 'q' does not exist.",
    ].join("\n");
    expect(Object.fromEntries(parseDiagnostics(out))).toEqual({
      "src/a.test.ts": 2,
      "src/b.test.ts": 1,
    });
  });

  it("ignores tsc's INDENTED continuation lines", () => {
    // A long union mismatch prints several indented lines under one
    // diagnostic. Counting those would inflate every file that has one.
    const out = [
      "src/a.test.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.",
      "  Types of property 'x' are incompatible.",
      "    Type 'string' is not assignable to type 'number'.",
    ].join("\n");
    expect(Object.fromEntries(parseDiagnostics(out))).toEqual({ "src/a.test.ts": 1 });
  });

  it("ignores the summary and any non-diagnostic noise", () => {
    const out = ["Found 3 errors in 2 files.", "", "npm warn something"].join("\n");
    expect(parseDiagnostics(out).size).toBe(0);
  });

  it("normalises Windows path separators", () => {
    const out = "src\\a.test.ts(1,1): error TS1: x";
    expect([...parseDiagnostics(out).keys()]).toEqual(["src/a.test.ts"]);
  });

  it("returns nothing for empty output", () => {
    expect(parseDiagnostics("").size).toBe(0);
  });
});

describe("compare — the ratchet, in both directions", () => {
  const counts = (o) => new Map(Object.entries(o));

  it("passes when every file matches its frozen number", () => {
    const r = compare(counts({ "a.test.ts": 3 }), { "a.test.ts": 3 });
    expect(r.failures).toEqual([]);
    expect(r.wins).toEqual([]);
  });

  it("FAILS on a file that is not baselined at all — new code is checked", () => {
    const r = compare(counts({ "new.test.ts": 1 }), {});
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain("NEW");
    expect(r.failures[0]).toContain("new.test.ts");
  });

  it("FAILS on a baselined file that got worse", () => {
    const r = compare(counts({ "a.test.ts": 4 }), { "a.test.ts": 3 });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain("GREW");
    expect(r.failures[0]).toContain("3 → 4");
  });

  it("reports an unrecorded IMPROVEMENT, so it cannot become headroom", () => {
    const r = compare(counts({ "a.test.ts": 1 }), { "a.test.ts": 3 });
    expect(r.failures).toEqual([]);
    expect(r.wins).toHaveLength(1);
    expect(r.wins[0]).toContain("was 3");
  });

  it("reports a baselined file that is now completely clean", () => {
    const r = compare(counts({}), { "a.test.ts": 3 });
    expect(r.wins).toHaveLength(1);
    expect(r.wins[0]).toContain("now clean");
  });

  it("reports every finding, not just the first", () => {
    const r = compare(counts({ "a.test.ts": 5, "b.test.ts": 1 }), { "a.test.ts": 2 });
    expect(r.failures).toHaveLength(2);
  });

  it("separates failures from wins in the same run", () => {
    const r = compare(counts({ "a.test.ts": 9, "b.test.ts": 1 }), {
      "a.test.ts": 2,
      "b.test.ts": 4,
    });
    expect(r.failures).toHaveLength(1);
    expect(r.wins).toHaveLength(1);
  });
});

describe("the committed baseline", () => {
  it("is a flat map of path → non-negative integer", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const entries = Object.entries(baseline);
    expect(entries.length).toBeGreaterThan(0);
    for (const [file, count] of entries) {
      expect(file, `${file} should be a repo-relative path`).toMatch(/^src\//);
      expect(Number.isInteger(count) && count > 0, `${file}: ${count}`).toBe(true);
    }
  });

  it("names only files that exist", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const tracked = new Set(
      execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n")
    );
    const missing = Object.keys(baseline).filter((f) => !tracked.has(f));
    expect(missing, `baselined but absent: ${missing.join(", ")}`).toEqual([]);
  });

  it("contains only test-tier files — production source is `pnpm typecheck`'s job", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const notTests = Object.keys(baseline).filter(
      (f) => !/(\.(test|spec|bench)\.[cm]?tsx?$|\/__tests__\/|^src\/test\/|^src\/bench\/)/.test(f)
    );
    expect(notTests, `not test-tier: ${notTests.join(", ")}`).toEqual([]);
  });
});

describe("wiring", () => {
  // Deliberately NOT an end-to-end `node check-test-types.mjs` run. That takes
  // ~50s (it is a full tsc over 404k lines) and `check:static` already invokes
  // the real thing on every `check:all` — so the duplicate proved nothing and
  // cost fifty seconds of every CI run. What CAN silently break is the
  // REGISTRATION: a gate that exists but is wired to nothing is the failure
  // this repo has hit before.
  it("is registered in check:static, so check:all actually runs it", () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
    expect(scripts["lint:test-types"]).toBe("node scripts/check-test-types.mjs");
    expect(scripts["check:static"]).toContain("pnpm lint:test-types");
  });

  it("checks the project the tsconfig actually defines", () => {
    expect(PROJECT).toBe("tsconfig.test.json");
    const config = readFileSync(join(ROOT, PROJECT), "utf8");
    // The whole point is the files tsconfig.json excludes.
    expect(config).toContain('"exclude": []');
    expect(config).toContain('"extends": "./tsconfig.json"');
  });
});
