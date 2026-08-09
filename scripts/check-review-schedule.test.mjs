/**
 * WI-AF3.1, WI-AF3.2, WI-AF3.3 — the baseline debt register (finding F5).
 *
 * WI-AF3.1 is the spike this grew out of, WI-AF3.2 the register and its
 * registration in the ratchet, WI-AF3.3 the staleness reporter pinned below.
 *
 * NO DEADLINES ARE TESTED HERE BECAUSE THERE ARE NONE. An earlier revision
 * policed a per-baseline review date; those dates were invented by the agent
 * that wrote them and attributed to the maintainer. Only one tracked baseline
 * has any paydown history to derive a rate from. What replaced them —
 * measured entry counts and days-since-change — needs no one's permission and
 * answers the question the deadline was standing in for: is this moving?
 *
 * Runs the REAL `scripts/check-review-schedule.mjs` against fixture manifests
 * and schedules in tmpdir. The script takes `--manifest` and `--schedule` so
 * both halves of its two-way staleness rule can be driven from a test; the
 * default paths are the repo's own.
 *
 * Semantics pinned:
 *   - every manifest baseline appears in EXACTLY ONE of `tracked` / `exempt`;
 *     a baseline in neither fails, and one in both fails;
 *   - every key in `tracked` / `exempt` names a real manifest entry — a stale
 *     key fails, the same both-directions rule every allowlist here follows;
 *   - an exemption without a reason fails: a claim that something is not debt
 *     has to say why, or it is just a quieter baseline;
 *   - a tracked baseline needs a target, or debt with no notion of "paid" never
 *     is;
 *   - `--report` measures entries and days-since-change against an INJECTED
 *     clock and is INFORMATIONAL — it exits 0. Nothing about a calendar can
 *     redden a PR, which is how a gate stays switched on;
 *   - validation is clock-independent and safe on the PR tier.
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
  tracked: { "a.json": "zero — every occurrence removed" },
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
      schedule: { tracked: OK.tracked, exempt: { "gone.json": "used to exist enough" } },
    });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/gone\.json/);
  });

  it("fails a baseline that is BOTH dated and exempt", () => {
    const r = run({
      paths: ["a.json"],
      schedule: { tracked: { "a.json": "zero" }, exempt: { "a.json": "also exempt, somehow" } },
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

  it("fails a tracked entry with no target", () => {
    const r = run({ paths: ["a.json", "b.json"], schedule: { ...OK, tracked: { "a.json": "" } } });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/target/i);
  });
});

describe("--report is a measurement, not a verdict", () => {
  const sched = {
    tracked: { "a.json": "zero", "b.json": "down" },
    exempt: {},
  };

  it("exits 0 — nothing on a calendar can fail a run", () => {
    const r = run({ paths: ["a.json", "b.json"], schedule: sched, args: ["--report", "--today=2026-09-01"] });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("lists every tracked baseline with its target", () => {
    const r = run({ paths: ["a.json", "b.json"], schedule: sched, args: ["--report", "--today=2026-09-01"] });
    expect(r.stdout).toMatch(/a\.json/);
    expect(r.stdout).toMatch(/b\.json/);
    expect(r.stdout).toMatch(/Unchanged for/);
  });

  it("does not list exempt baselines — they are not debt", () => {
    const r = run({
      paths: ["a.json", "b.json"],
      schedule: { tracked: { "a.json": "zero" }, exempt: { "b.json": "vendored upstream corpus" } },
      args: ["--report", "--today=2026-09-01"],
    });
    expect(r.stdout).toMatch(/a\.json/);
    expect(r.stdout).not.toMatch(/b\.json/);
  });

  it("rejects an unparseable --today rather than silently using now", () => {
    const r = run({ paths: ["a.json", "b.json"], schedule: sched, args: ["--report", "--today=not-a-date"] });
    expect(r.status).toBe(1);
  });

  it("validation mode needs no clock at all", () => {
    const r = run({ paths: ["a.json", "b.json"], schedule: sched });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});

describe("the real repository", () => {
  it("its own register covers every registered baseline", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd: REPO });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
