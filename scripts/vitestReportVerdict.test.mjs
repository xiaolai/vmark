/**
 * Self-test for the vitest-report verdict.
 *
 * This logic used to live in a `node -e '…'` string inside
 * `scripts/check-ui-phase.sh`, where nothing checked it and two branches — "no
 * suite matches on disk" and "N suite(s) failed to run" — were unreachable
 * from the shell harness that drove it. Every branch is constructed here
 * (audit R2 #94).
 *
 * @coordinates-with scripts/vitestReportVerdict.mjs — the module under test
 * @coordinates-with scripts/check-ui-phase.sh — its caller
 * @module scripts/vitestReportVerdict.test
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { verdictReasons } from "./vitestReportVerdict.mjs";

const MODULE = path.join(import.meta.dirname, "vitestReportVerdict.mjs");
const ROOT = "/repo";
const suite = (name, ...statuses) => ({
  name,
  status: "passed",
  assertionResults: statuses.map((status) => ({ status })),
});
const green = (...names) => ({ numFailedTestSuites: 0, testResults: names.map((n) => suite(n, "passed")) });

describe("verdictReasons", () => {
  it("is silent when every expected suite ran and passed", () => {
    expect(verdictReasons(green("src/a.test.ts", "src/b.test.ts"), ["src/a.test.ts", "src/b.test.ts"], 0, ROOT)).toEqual([]);
  });

  it("relativises absolute suite names against the root, and leaves relative ones alone", () => {
    const report = green("/repo/src/a.test.ts");
    expect(verdictReasons(report, ["src/a.test.ts"], 0, ROOT)).toEqual([]);
    // A sibling checkout whose path merely STARTS with the root is not this
    // tree: `/repo-old/src/a.test.ts` must not be relativised into a match.
    expect(verdictReasons(green("/repo-old/src/a.test.ts"), ["src/a.test.ts"], 0, ROOT)).toEqual([
      "src/a.test.ts did not run",
    ]);
  });

  // audit R2 #96 — the verdict used to come from the report ALONE, so a run
  // that wrote a green report and then died was reported as successful.
  it("fails on a non-zero vitest status even when the report is green", () => {
    expect(verdictReasons(green("src/a.test.ts"), ["src/a.test.ts"], 7, ROOT)).toEqual(["vitest exited 7"]);
  });

  // audit R2 #97 — a same-SIZED but different set used to pass, because the
  // check compared counts. `find`'s -name and vitest's substring filter are
  // different matchers.
  it("names the suite that did not run, even when another of the same size did", () => {
    expect(verdictReasons(green("src/stand-in.test.ts"), ["src/wanted.test.ts"], 0, ROOT)).toContain(
      "src/wanted.test.ts did not run",
    );
  });

  // An empty expectation means the filter matched nothing ON DISK — the phase
  // asserted about no file at all, which is not a pass.
  it("refuses a run whose filter matched nothing on disk", () => {
    expect(verdictReasons({ numFailedTestSuites: 0, testResults: [] }, [], 0, ROOT)).toContain(
      "no suite matches on disk",
    );
  });

  it("reports suites that failed to run at all", () => {
    const report = { numFailedTestSuites: 2, testResults: [suite("src/a.test.ts", "passed")] };
    expect(verdictReasons(report, ["src/a.test.ts"], 0, ROOT)).toEqual(["2 suite(s) failed to run"]);
  });

  // audit 20260907 #66 — an all-skipped suite reports `status: "passed"` with
  // only skipped assertions and vanishes into a green total.
  it.each([
    [["skipped"], "src/a.test.ts: no passing test (skipped)"],
    [[], "src/a.test.ts: no passing test (empty)"],
    [["passed", "failed", "failed"], "src/a.test.ts: 2 failed test(s)"],
  ])("judges a suite per case, not per total (%j)", (statuses, reason) => {
    const report = { numFailedTestSuites: 0, testResults: [suite("src/a.test.ts", ...statuses)] };
    expect(verdictReasons(report, ["src/a.test.ts"], 0, ROOT)).toContain(reason);
  });

  it("treats a report with no testResults array as having run nothing", () => {
    expect(verdictReasons({}, ["src/a.test.ts"], 0, ROOT)).toContain("src/a.test.ts did not run");
  });
});

describe("the CLI", () => {
  // realpath: on macOS $TMPDIR is a symlink, and the CLI relativises against
  // the resolved `process.cwd()` of the child.
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "verdict-cli-")));
  const write = (name, body) => {
    const file = path.join(dir, name);
    writeFileSync(file, body);
    return file;
  };
  const run = (...args) => spawnSync(process.execPath, [MODULE, ...args], { encoding: "utf8", cwd: dir });

  it("exits 0 on a clean report and 1 with the reasons on a dirty one", () => {
    const file = write("green.json", JSON.stringify(green(path.join(dir, "src/a.test.ts"))));
    expect(run(file, "src/a.test.ts", "0").status).toBe(0);
    const dirty = run(file, "src/a.test.ts", "9");
    expect(dirty.status).toBe(1);
    expect(dirty.stdout).toContain("vitest exited 9");
  });

  // The caller used to swallow the validator's own stderr, so a crash inside
  // it degraded to the message "report unreadable" with no reason.
  it("says WHY a report could not be read", () => {
    const file = write("broken.json", "{ not json");
    const r = run(file, "src/a.test.ts", "0");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("report unreadable");
    expect(r.stdout).toContain("broken.json");
  });

  it("refuses a call with missing arguments rather than reading undefined", () => {
    expect(run().status).toBe(1);
    expect(run().stdout).toContain("needs <report.json>");
  });
});
