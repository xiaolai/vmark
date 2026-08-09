/**
 * WI-AF2.3 / WI-AF2.4 — gate liveness (findings F1, F2).
 *
 * Runs the REAL `scripts/check-gate-liveness.mjs` against fixture workflow
 * directories and a stubbed `gh` on PATH. The script takes `--workflows` and
 * `--today` so discovery and the clock can both be driven from a test.
 *
 * WHY THIS EXISTS. `tier0-e2e.yml` was merged on 2026-08-04 and had run ZERO
 * times when this plan found it five days later. It reviewed clean, it was
 * wired correctly, and it protected nothing. mutation.yml is the same defect
 * with a longer history: seven scheduled runs killed by their own 60-minute
 * timeout (which GitHub reports as `cancelled`, reading like an operator
 * action) and one run whose conclusion was SUCCESS while its only job's was
 * FAILURE. A gate that has stopped producing verdicts looks exactly like a gate
 * that is passing.
 *
 * Semantics pinned:
 *   - discovery is by MARKER (`# liveness-gate: true`) inside the workflow
 *     file, not a hand-maintained list — a list is a second thing to keep in
 *     sync, and it drifts the first time someone adds a workflow;
 *   - ZERO runs is the LOUDEST case, not the quietest. It is the F1 state, and
 *     a checker that treats "no data" as "no problem" would have said nothing
 *     about the very workflow that motivated it;
 *   - a verdict is a COMPLETED run that concluded success or failure.
 *     `cancelled` and `skipped` are not verdicts — that distinction is the
 *     whole mutation.yml story;
 *   - stale beyond cadence + grace → fail, naming the gate and its last verdict;
 *   - fails closed on a missing `gh`, an API error, or malformed JSON. A
 *     liveness checker that goes quiet when it cannot see is the thing it exists
 *     to detect;
 *   - a marked workflow missing its cadence declaration fails, rather than
 *     being silently assigned a default nobody chose.
 *
 * @coordinates-with .github/workflows/gate-liveness.yml
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-gate-liveness.mjs");

/** A workflow file, marked or not. */
function workflow({ name, marked = true, cadence = 8, onFailure = "rolling-issue" }) {
  return [
    `name: ${name}`,
    "#",
    marked ? "# liveness-gate: true" : "# (not a liveness gate)",
    marked && cadence !== null ? `# cadence-days: ${cadence}` : "",
    marked && onFailure ? `# on-failure: ${onFailure}` : "",
    "on:",
    "  schedule:",
    '    - cron: "0 6 * * 1"',
    "jobs:",
    "  run:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo hi",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * `runs` maps workflow FILE NAME → array of {conclusion, status, updatedAt}.
 * The stub answers `gh api .../runs` per workflow, so the script's real query
 * shape is part of the contract rather than something the test paraphrases.
 */
function fixture({ workflows, runs = {}, ghMode = "ok" }) {
  const dir = mkdtempSync(path.join(tmpdir(), "liveness-"));
  const wfDir = path.join(dir, "workflows");
  mkdirSync(wfDir, { recursive: true });
  for (const [file, body] of Object.entries(workflows)) {
    writeFileSync(path.join(wfDir, file), body);
  }
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  if (ghMode !== "missing") {
    const table = JSON.stringify(runs).replaceAll("'", "'\\''");
    const body =
      ghMode === "error"
        ? '#!/bin/bash\necho "gh: API rate limit" >&2\nexit 1\n'
        : ghMode === "malformed"
          ? "#!/bin/bash\necho 'not json at all'\n"
          : `#!/bin/bash
# Args look like: api repos/{owner}/{repo}/actions/workflows/<file>/runs ...
for a in "$@"; do
  case "$a" in
    */actions/workflows/*/runs*) wf=\${a#*/actions/workflows/}; wf=\${wf%%/runs*};;
  esac
done
node -e '
  const table = JSON.parse(process.argv[1]);
  const wf = process.argv[2];
  process.stdout.write(JSON.stringify({ workflow_runs: table[wf] ?? [] }));
' '${table}' "$wf"
`;
    const p = path.join(bin, "gh");
    writeFileSync(p, body);
    chmodSync(p, 0o755);
  }
  return { dir, wfDir, bin };
}

function run({ wfDir, bin }, args = []) {
  return spawnSync(process.execPath, [SCRIPT, `--workflows=${wfDir}`, ...args], {
    encoding: "utf8",
    cwd: REPO,
    env: { ...process.env, PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin` },
  });
}

const verdict = (when, conclusion = "success") => ({
  status: "completed",
  conclusion,
  updated_at: when,
});

describe("discovery is by marker", () => {
  it("ignores an unmarked workflow entirely", () => {
    const f = fixture({
      workflows: { "plain.yml": workflow({ name: "Plain", marked: false }) },
      runs: {},
    });
    const r = run(f, ["--today=2026-08-09"]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/0 liveness gate/i);
  });

  it("fails a marked workflow with no cadence declaration", () => {
    const f = fixture({
      workflows: { "a.yml": workflow({ name: "A", cadence: null }) },
      runs: { "a.yml": [verdict("2026-08-08T00:00:00Z")] },
    });
    const r = run(f, ["--today=2026-08-09"]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/cadence/i);
  });
});

describe("zero runs is the loudest case (F1)", () => {
  it("fails a marked workflow that has never run, saying so plainly", () => {
    const f = fixture({ workflows: { "never.yml": workflow({ name: "Never" }) }, runs: {} });
    const r = run(f, ["--today=2026-08-09"]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/never/i);
  });
});

describe("what counts as a verdict", () => {
  it("accepts a recent success", () => {
    const f = fixture({
      workflows: { "a.yml": workflow({ name: "A" }) },
      runs: { "a.yml": [verdict("2026-08-08T00:00:00Z")] },
    });
    expect(run(f, ["--today=2026-08-09"]).status).toBe(0);
  });

  it("accepts a recent FAILURE — a red gate is still a working gate", () => {
    const f = fixture({
      workflows: { "a.yml": workflow({ name: "A" }) },
      runs: { "a.yml": [verdict("2026-08-08T00:00:00Z", "failure")] },
    });
    expect(run(f, ["--today=2026-08-09"]).status).toBe(0);
  });

  it("does NOT accept `cancelled` — the mutation.yml case", () => {
    // Seven scheduled mutation runs were killed by their own timeout, which
    // GitHub reports as cancelled. Counting those as verdicts would have
    // reported that workflow healthy for two months.
    const f = fixture({
      workflows: { "a.yml": workflow({ name: "A" }) },
      runs: { "a.yml": [verdict("2026-08-08T00:00:00Z", "cancelled")] },
    });
    const r = run(f, ["--today=2026-08-09"]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/cancelled|no verdict/i);
  });

  it("does NOT accept an in-progress run as a verdict", () => {
    const f = fixture({
      workflows: { "a.yml": workflow({ name: "A" }) },
      runs: { "a.yml": [{ status: "in_progress", conclusion: null, updated_at: "2026-08-09T00:00:00Z" }] },
    });
    expect(run(f, ["--today=2026-08-09"]).status).toBe(1);
  });
});

describe("staleness against the declared cadence", () => {
  it("passes inside cadence + grace", () => {
    const f = fixture({
      workflows: { "a.yml": workflow({ name: "A", cadence: 8 }) },
      runs: { "a.yml": [verdict("2026-08-01T00:00:00Z")] },
    });
    expect(run(f, ["--today=2026-08-09"]).status).toBe(0);
  });

  it("fails once the last verdict is older than cadence + grace, naming the age", () => {
    const f = fixture({
      workflows: { "a.yml": workflow({ name: "A", cadence: 8 }) },
      runs: { "a.yml": [verdict("2026-06-01T00:00:00Z")] },
    });
    const r = run(f, ["--today=2026-08-09"]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/a\.yml/);
  });
});

describe("fails closed", () => {
  it.each(["missing", "error", "malformed"])("when gh is %s", (ghMode) => {
    const f = fixture({
      workflows: { "a.yml": workflow({ name: "A" }) },
      runs: { "a.yml": [verdict("2026-08-08T00:00:00Z")] },
      ghMode,
    });
    const r = run(f, ["--today=2026-08-09"]);
    expect(r.status, `gh ${ghMode} must not pass`).not.toBe(0);
  });
});

describe("the real repository", () => {
  it("marks its scheduled gates and declares a cadence for each", () => {
    // Structure only — no network. Proves the markers parse and every marked
    // workflow is completely declared, which is the half a test can own.
    const r = spawnSync(process.execPath, [SCRIPT, "--list"], { encoding: "utf8", cwd: REPO });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    for (const wf of ["tier0-e2e.yml", "mutation.yml", "baseline-review.yml"]) {
      expect(r.stdout, `${wf} should be a declared liveness gate`).toContain(wf);
    }
  });

  it("is watched by something other than itself", () => {
    // A scheduled workflow cannot report its own silence: if it stops firing,
    // it is not there to complain. gate-liveness.yml watches the others, and
    // baseline-review.yml watches gate-liveness.yml on a different day.
    const other = path.join(REPO, ".github/workflows/baseline-review.yml");
    const body = spawnSync("cat", [other], { encoding: "utf8" }).stdout;
    expect(body).toMatch(/check-gate-liveness\.mjs[^\n]*--only[^\n]*gate-liveness/);
  });
});
