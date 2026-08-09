/**
 * WI-AF3.1 — the baseline review schedule (finding F5).
 *
 * Runs the REAL `scripts/check-review-schedule.mjs` against fixture manifests
 * and schedules in tmpdir. The script takes `--manifest` and `--schedule` so
 * both halves of its two-way staleness rule can be driven from a test; the
 * default paths are the repo's own.
 *
 * Semantics pinned:
 *   - every manifest baseline appears in EXACTLY ONE of `reviews` / `exempt`;
 *     a baseline in neither fails, and one in both fails;
 *   - every key in `reviews` / `exempt` names a real manifest entry — a stale
 *     key fails, the same both-directions rule every allowlist here follows;
 *   - an exemption without a reason fails: a claim that something is not debt
 *     has to say why, or it is just a quieter baseline;
 *   - dated entries need a target, or "review it" means nothing in particular;
 *   - dates are validated as real YYYYMMDD calendar dates — 20261301 and
 *     20260231 are rejected, not silently sorted;
 *   - `--report` lists overdue entries against an INJECTED clock and exits
 *     non-zero when any are overdue, so the scheduled job has something to act
 *     on, while the default (validation) mode is clock-independent and safe to
 *     run in PR CI.
 *
 * The overdue REPORT deliberately never runs on the PR tier: a date-triggered
 * failure would redden an unrelated PR with nothing its author can do about it,
 * which is how a gate gets switched off. See ADR-1 in the plan.
 *
 * @coordinates-with scripts/baseline-review-schedule.json
 * @coordinates-with scripts/baselineRatchetManifest.mjs — the entries this covers
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-review-schedule.mjs");

/** A fixture manifest module exporting the given baseline paths. */
function manifestFixture(dir, paths) {
  const file = path.join(dir, "manifest.mjs");
  writeFileSync(
    file,
    `export const MANIFEST = { entries: ${JSON.stringify(paths.map((p) => ({ path: p, checks: [] })))}, allowRaise: [] };\n`,
  );
  return file;
}

function scheduleFixture(dir, doc) {
  const file = path.join(dir, "schedule.json");
  writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}

function run({ paths, schedule, args = [] }) {
  const dir = mkdtempSync(path.join(tmpdir(), "review-sched-"));
  const m = manifestFixture(dir, paths);
  const s = scheduleFixture(dir, schedule);
  return spawnSync(process.execPath, [SCRIPT, `--manifest=${m}`, `--schedule=${s}`, ...args], {
    encoding: "utf8",
    cwd: REPO,
  });
}

const OK = {
  reviews: { "a.json": 20261001 },
  targets: { "a.json": "zero" },
  exempt: { "b.json": "vendored upstream corpus" },
};

describe("two-way staleness", () => {
  it("passes when every baseline is dated or exempt", () => {
    const r = run({ paths: ["a.json", "b.json"], schedule: OK });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("fails a baseline covered by neither, naming it", () => {
    const r = run({ paths: ["a.json", "b.json", "c.json"], schedule: OK });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/c\.json/);
  });

  it("fails a schedule key that names no manifest entry", () => {
    const r = run({
      paths: ["a.json"],
      schedule: { ...OK, exempt: { "gone.json": "used to exist" } },
    });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/gone\.json/);
  });

  it("fails a baseline that is BOTH dated and exempt", () => {
    const r = run({
      paths: ["a.json"],
      schedule: { reviews: { "a.json": 20261001 }, targets: { "a.json": "zero" }, exempt: { "a.json": "also exempt?" } },
    });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/both/i);
  });
});

describe("claims must be justified", () => {
  it("fails an exemption with an empty reason", () => {
    const r = run({ paths: ["a.json", "b.json"], schedule: { ...OK, exempt: { "b.json": "  " } } });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/reason/i);
  });

  it("fails a dated entry with no target", () => {
    const r = run({ paths: ["a.json", "b.json"], schedule: { ...OK, targets: {} } });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/target/i);
  });
});

describe("dates are real dates", () => {
  it.each([20261301, 20260231, 2026101, 0, -1])("rejects %s", (bad) => {
    const r = run({
      paths: ["a.json", "b.json"],
      schedule: { ...OK, reviews: { "a.json": bad } },
    });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/date/i);
  });

  it("accepts a leap day", () => {
    const r = run({
      paths: ["a.json", "b.json"],
      schedule: { ...OK, reviews: { "a.json": 20280229 } },
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

describe("--report and the injected clock", () => {
  const sched = {
    reviews: { "a.json": 20261001, "b.json": 20270101 },
    targets: { "a.json": "zero", "b.json": "down" },
    exempt: {},
  };

  it("reports nothing and exits 0 before any deadline", () => {
    const r = run({ paths: ["a.json", "b.json"], schedule: sched, args: ["--report", "--today=20260901"] });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("names the overdue baseline and exits non-zero once its date passes", () => {
    const r = run({ paths: ["a.json", "b.json"], schedule: sched, args: ["--report", "--today=20261002"] });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/a\.json/);
    expect(r.stdout + r.stderr).not.toMatch(/b\.json/);
  });

  it("treats the due day itself as not yet overdue", () => {
    const r = run({ paths: ["a.json", "b.json"], schedule: sched, args: ["--report", "--today=20261001"] });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("validation mode is clock-independent — no --today needed", () => {
    // The PR tier runs this. If validation depended on the date, the gate would
    // change its mind overnight on an unchanged tree.
    const r = run({ paths: ["a.json", "b.json"], schedule: sched });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

describe("the real repository", () => {
  it("its own schedule covers every registered baseline", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd: REPO });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
