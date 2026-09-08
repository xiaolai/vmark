// Joins the EXTERNAL PROGRAMS the gates tier executes to the ones CI installs.
//
// Why this exists: on 2026-09-08 two gates-tier tests failed in CI having
// passed locally, because they execute `zsh` and `tokei` and neither is on
// ubuntu-latest. Both tests refuse to skip when their tool is missing — the
// correct posture, and why the failure was loud rather than silent — but it
// arrived five minutes into a twenty-minute job, after the branch was pushed.
// The tools are now installed by `fe-static`; this makes the NEXT one fail in
// seconds, on the machine that adds it.
//
// It is a DECLARATION checked in both directions, not an inferred scan. A scan
// was tried first and is the wrong instrument: the first string argument to
// `run(...)` in this tier is just as often a subcommand of `dod-syntax.mjs`
// (`rust-code-grep`, `ts-has-test-case`), a CI job name, or a shell builtin, so
// inference reports ten false names and buries the two real ones.
//
// RUNNER_PROVIDED is a claim about the runner image, so it stays short:
// anything not plainly guaranteed belongs in the install step instead.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CI = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** On every ubuntu-latest and macOS runner. Installing these would be noise. */
const RUNNER_PROVIDED = ["bash", "sh", "git", "python3"];

/** NOT on the runner. `fe-static` must install each, or the test that runs it fails there. */
const MUST_BE_INSTALLED = [
  // scripts/shell-integration-smoke.test.mjs drives a real interactive zsh
  // under a pty; the whole point of WI-FL5.11 is that the integration RUNS.
  "zsh",
  // scripts/gen-feature-ledger.test.mjs reproduces the audit R2 #127
  // measurement against real tokei: `--exclude` does not apply to a path given
  // as an explicit file.
  "tokei",
];

/** The `fe-static` job's own block, so a tool installed for another job does not count. */
function feStaticBlock() {
  const start = CI.indexOf("\n  fe-static:");
  expect(start, "ci.yml must define an fe-static job").toBeGreaterThan(-1);
  const rest = CI.slice(start + 1);
  const end = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Gates-tier test sources, which is where these programs are executed from. */
function gatesTierSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(p);
      } else if (/\.test\.mjs$/.test(entry.name)) {
        out.push(readFileSync(p, "utf8"));
      }
    }
  };
  walk(join(ROOT, "scripts"));
  return out;
}

/** Does any gates-tier test name this program as a quoted argument? */
function isExecutedByGatesTier(bin, sources) {
  return sources.some((s) => s.includes(`"${bin}"`));
}

describe("the gates tier's external programs are supplied by the job that runs it", () => {
  it("fe-static installs every program the runner does not provide", () => {
    const block = feStaticBlock();
    const missing = MUST_BE_INSTALLED.filter((b) => !block.includes(b));
    expect(
      missing,
      `fe-static runs the gates tier but installs none of: ${missing.join(", ")}. ` +
        `Add the install step to .github/workflows/ci.yml — do NOT make the test skip when ` +
        `its program is absent, which is how this class stays invisible.`,
    ).toEqual([]);
  });

  it("every installed program is still executed by a gates-tier test", () => {
    const sources = gatesTierSources();
    const stale = MUST_BE_INSTALLED.filter((b) => !isExecutedByGatesTier(b, sources));
    expect(
      stale,
      `fe-static installs these and no gates-tier test executes them any more: ${stale.join(", ")}. ` +
        `Remove the install step and this entry, or the list becomes a record of what CI used to be for.`,
    ).toEqual([]);
  });

  it("the runner-provided list carries nothing the runner might not have", () => {
    // A guard on the claim itself: these four are POSIX/base-image staples. If
    // something less certain is ever added here, it belongs in the install step.
    expect(RUNNER_PROVIDED.every((b) => /^(bash|sh|git|python3|node)$/.test(b))).toBe(true);
  });
});
