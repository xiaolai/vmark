// WI-UI0.5 — self-test for the UI-consistency plan's DoD script.
/**
 * The script asserts tree state per phase; these tests pin its own mechanics
 * so a broken assertion helper cannot report a phase green (rule: green is not
 * evidence that anything happened).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
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
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("confirmAction.ts exists");
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
