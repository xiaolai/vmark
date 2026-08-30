// WI-UI0.5 — self-test for the UI-consistency plan's DoD script.
/**
 * The script asserts tree state per phase; these tests pin its own mechanics
 * so a broken assertion helper cannot report a phase green (rule: green is not
 * evidence that anything happened).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A `pnpm` shim that always exits 0: the WIRING assertions are this test's
// subject; the real gates the script re-runs have their own self-tests in this
// same tier, and running them again here made the test time out under
// check:predelta's 8-way pool.
const shimDir = mkdtempSync(path.join(tmpdir(), "ui-phase-shim-"));
writeFileSync(path.join(shimDir, "pnpm"), "#!/bin/sh\nexit 0\n");
chmodSync(path.join(shimDir, "pnpm"), 0o755);

function run(...args) {
  return spawnSync("bash", ["scripts/check-ui-phase.sh", ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
  });
}

describe("check-ui-phase.sh", () => {
  it("exits 64 with usage when no phase is given", () => {
    const res = run();
    expect(res.status).toBe(64);
    expect(res.stdout).toContain("Usage");
  });

  it("exits 64 on an unknown phase", () => {
    expect(run("9").status).toBe(64);
  });

  it("phase 4 is GREEN now that its artifacts landed (the flip its DoD required)", () => {
    // Until WI-UI4.x landed, this test pinned the fail-closed direction (red
    // with the missing paths named). The flip to green IS part of the DoD.
    const res = run("4");
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain("confirmAction.ts exists");
  });

  it("phase 4 stays green while a sibling test's transient dev-docs fixture exists", () => {
    // clean-dev.test.mjs creates dev-docs/grills/… in the REAL repo root and
    // removes it in afterEach; on a tree with no dev-docs (CI, fresh worktree)
    // that window overlaps this tier's parallel pool. A markerless dev-docs is
    // a fixture, not a maintainer tree — the probe keys on dev-docs/README.md.
    // Directly under dev-docs/, NOT under dev-docs/grills/: clean-dev's own
    // "no-op when grills is absent" test early-returns whenever grills
    // exists, and a probe inside grills would make it skip silently.
    const probe = path.join(REPO, "dev-docs/__ui-phase-race-probe__");
    mkdirSync(probe, { recursive: true });
    try {
      const res = run("4");
      expect(res.status, res.stdout + res.stderr).toBe(0);
    } finally {
      // Remove only what is certainly ours: the probe itself, then a
      // NON-recursive rmdir on dev-docs — it fails on any directory that
      // still has content (a maintainer's real dev-docs, or a sibling test's
      // live fixture), which is exactly the safe outcome.
      rmSync(probe, { recursive: true, force: true });
      try {
        rmdirSync(path.dirname(probe));
      } catch {
        // non-empty or already gone — leave it alone
      }
    }
  });

  it("phase 0 reports every gate wiring assertion", () => {
    const res = run("0");
    // The wiring half of phase 0 is landed; PNG fixtures may or may not exist
    // on this machine (dev-docs is maintainer-local). Assert the assertions
    // RAN, and that none of the wiring ones failed.
    expect(res.stdout).toContain("lint:theme-contrast npm entry");
    expect(res.stdout).not.toMatch(/✗ .*npm entry/);
    expect(res.stdout).not.toMatch(/✗ .*registered/);
  });
});
