// WI-AL0.7 — agent-edit-ledger spike artifacts: an unreadable required folder is a one-line diagnostic, and generatedAt must name a real calendar instant
/**
 * Pins two input-handling edges of the REAL `scripts/check-al-spike-results.mjs`
 * that the main self-test (check-al-spike-results.test.mjs) does not reach:
 *   - the txn tests folder and the review probes folder are read to derive the
 *     areas each verdict requires; when one exists but cannot be listed, the
 *     checker prints its one-line diagnostic naming that folder and exits 1 —
 *     never a stack trace — and an area that does not need the folder is
 *     unaffected;
 *   - `generatedAt` is parsed strictly: a date JavaScript would silently
 *     normalise (February 30, hour 24, a 13th month) is refused, while real
 *     leap days are accepted.
 *
 * @coordinates-with scripts/check-al-spike-results.mjs — the checker under test
 * @module scripts/check-al-spike-results.inputs.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkSpikeResult } from "./check-al-spike-results.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO, "scripts", "check-al-spike-results.mjs");
const GRILLS = "dev-docs/grills/agent-edit-ledger";
const made = [];
const locked = [];
afterAll(() => {
  for (const dir of locked) chmodSync(dir, 0o755);
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const put = (root, rel, body) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
};

/** A root whose `spike` has a results.json and whose `lockedRel` folder exists but cannot be listed. */
function lockedRoot(spike, lockedRel) {
  const root = mkdtempSync(path.join(tmpdir(), "al-spike-inputs-"));
  made.push(root);
  put(root, `${GRILLS}/${spike}/results.json`, "{}");
  put(root, `${lockedRel}/x.rs`, "// x\n");
  const dir = path.join(root, lockedRel);
  chmodSync(dir, 0o000);
  locked.push(dir);
  return root;
}

function check(root, spike) {
  const r = spawnSync(process.execPath, [CLI, `--root=${root}`, spike], { encoding: "utf8", cwd: REPO, timeout: 30_000 });
  if (r.error) throw r.error;
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

describe.skipIf(isRoot)("check-al-spike-results — an unreadable required folder", () => {
  it.each([
    ["txn", `${GRILLS}/txn/tests`],
    ["review", `${GRILLS}/review/probes`],
  ])("%s: %s that cannot be listed is a one-line diagnostic, not a stack trace", (spike, rel) => {
    const r = check(lockedRoot(spike, rel), spike);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(`cannot read ${rel}: EACCES`);
    expect(r.out).not.toMatch(/^\s+at /m);
    expect(r.out.trim().split("\n")).toHaveLength(1);
  });

  it("an area that does not read the folder does not list it", () => {
    const root = lockedRoot("anchor", `${GRILLS}/txn/tests`);
    const r = check(root, "anchor");
    expect(r.status, r.out).toBe(1);
    expect(r.out).not.toContain("txn/tests");
    expect(r.out).not.toMatch(/^\s+at /m);
  });
});

describe("checkSpikeResult — generatedAt names a real instant", () => {
  const NOW = Date.parse("2026-10-23T12:00:00Z");
  const problems = (generatedAt) =>
    checkSpikeResult("anchor", { workItem: "WI-AL0.9", generatedAt }, { current: { error: "fixture" }, nowMs: NOW }).problems.filter((p) => p.includes("generatedAt"));

  it.each([
    "2026-02-30T00:00:00Z",
    "2026-02-29T00:00:00Z",
    "1900-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-00-10T00:00:00Z",
    "2026-01-00T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T23:60:00Z",
    "2026-01-01T23:59:60Z",
    "2026-01-01T00:00:00+24:00",
    "2026-01-01T00:00:00+05:60",
    "2026-01-01",
    "",
  ])("%j is refused", (stamp) => {
    expect(problems(stamp)).toEqual([`generatedAt ${JSON.stringify(stamp)} is not an ISO-8601 date-time`]);
  });

  it.each([
    "2024-02-29T00:00:00Z",
    "2000-02-29T23:59:59.999Z",
    "2026-10-23T11:00Z",
    "2026-10-23T13:30:00+05:30",
    "2026-10-23T03:00:00-08:00",
  ])("%j is accepted", (stamp) => {
    expect(problems(stamp)).toEqual([]);
  });

  it("a real date beyond the skew is still in the future", () => {
    expect(problems("2026-10-24T12:00:00Z")).toEqual(["generatedAt 2026-10-24T12:00:00Z is in the future"]);
  });
});
