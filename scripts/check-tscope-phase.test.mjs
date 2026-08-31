// WI-TS0.1 — DoD gate self-test for scripts/check-tscope-phase.sh.
// WI-TS0.2 / WI-TS0.3 — linked here deliberately: the phase-0 leg of the gate
//   asserts exactly those WIs' deliverables (the extracted modules plus the
//   file-size ceilings on useTerminalSessions.ts and workspaceInstancesStore.ts),
//   and this file pins that the gate actually fails when they are absent.
// WI-TS5.2 / WI-TS5.3 — same rationale one phase later: journeys and website
//   docs live outside every unit-test tier, so their DoD artifacts (journey
//   file, rail-OFF wrap, CI list entry, guide sections, rule-21 mapping) are
//   asserted by the gate's phase-5 leg, which this file exercises.
//
// Conventions follow check-wi-linkage.test.mjs: the REAL script runs as a
// subprocess. For the missing-artifact case it is SYMLINKED into a scratch
// tree — the script does `cd "$(dirname "$0")/.."`, so the symlink's parent
// decides which tree is checked while the bytes executed stay the real
// script's. The linkage smoke test runs against the real repo and asserts
// only the PARSE result ("WIs found: N"), never the linkage verdict — the
// verdict depends on commit history this test must not assume.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-tscope-phase.sh");
const PLAN = ".claude/tdd-guardian/20260831-terminal-per-instance-sessions.md";

function run(args, cwd = REPO) {
  return spawnSync("bash", [SCRIPT, ...args], { cwd, encoding: "utf8" });
}

describe("check-tscope-phase.sh", () => {
  it("exits 64 with a usage message on no argument", () => {
    const r = run([]);
    expect(r.status).toBe(64);
    expect(r.stdout).toContain("Usage:");
  });

  it("exits 64 on an unknown phase", () => {
    const r = run(["9"]);
    expect(r.status).toBe(64);
    expect(r.stdout).toContain("unknown phase");
  });

  it("fails (non-zero) when a phase's artifacts are missing", () => {
    // Scratch tree with NO artifacts at all. The symlinked script cd's to the
    // scratch root, so every assert_file/assert_grep must fail — a gate that
    // passed here would be asserting nothing.
    const root = mkdtempSync(path.join(tmpdir(), "tscope-phase-"));
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    symlinkSync(SCRIPT, path.join(root, "scripts", "check-tscope-phase.sh"));
    const r = spawnSync(
      "bash",
      [path.join(root, "scripts", "check-tscope-phase.sh"), "0"],
      { cwd: root, encoding: "utf8" },
    );
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("missing");
  });

  it("smoke: the WI-linkage invocation parses ≥ 1 WI for phase TS0", () => {
    // The gate invokes check-wi-linkage.sh with `--phase=TS<N>`. A bare
    // numeric phase would match zero WI-TS ids and trip the fail-closed
    // zero-match branch — this pins that the TS spelling actually parses the
    // plan's declarations (3 WIs in phase TS0).
    const r = spawnSync(
      "bash",
      ["scripts/check-wi-linkage.sh", PLAN, "--phase=TS0"],
      { cwd: REPO, encoding: "utf8" },
    );
    expect(r.stdout).not.toContain("no WI-IDs matching");
    expect(r.stdout).toMatch(/WIs found: 3/);
  });

  it("the bare-numeric spelling fails closed (the trap WI-TS0.1 documents)", () => {
    const r = spawnSync(
      "bash",
      ["scripts/check-wi-linkage.sh", PLAN, "--phase=0"],
      { cwd: REPO, encoding: "utf8" },
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("no WI-IDs matching");
  });
});
