// WI-UI0.5 — self-test for the UI-consistency plan's DoD script.
/**
 * The script asserts tree state per phase; these tests pin its own mechanics
 * so a broken assertion helper cannot report a phase green (rule: green is not
 * evidence that anything happened).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
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
    env: {
      ...process.env,
      PATH: `${shimDir}:${process.env.PATH}`,
      // clean-dev.test.mjs fabricates fixtures under the REAL dev-docs/ in
      // this same tier, so a `-d dev-docs` probe mid-run is a race with a
      // sibling worker. Force the absent branch so the assertion set is
      // deterministic on every machine class.
      VMARK_UI_PHASE_NO_DEVDOCS: "1",
    },
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
    // Pins that the no-devdocs override took effect — without it this run
    // would race clean-dev.test.mjs's fixture on any checkout where
    // dev-docs/ is absent (CI, fresh worktrees).
    expect(res.stdout).toContain("dev-docs/ absent or disabled");
  });

  // The override above never exercises the maintainer branch, so on a real
  // maintainer tree run phases 0 and 4 once without it. The condition is
  // dev-docs/README.md — the index AGENTS.md mandates — chosen because it is
  // INDEPENDENT of every artifact these runs assert: deleting an asserted
  // artifact fails the test rather than skipping it. No gate test fabricates
  // README.md in the real repo (clean-dev.test.mjs creates only grills/
  // fixtures; the followups tests build temp roots), and on a tree where
  // README.md exists dev-docs/ itself is permanent, so nothing here races.
  const MAINTAINER_TREE = existsSync(path.join(REPO, "dev-docs/README.md"));

  function runMaintainer(phase) {
    return spawnSync("bash", ["scripts/check-ui-phase.sh", phase], {
      cwd: REPO,
      encoding: "utf8",
      // "0" explicitly: an override inherited from the caller's environment
      // must not silently turn this into a second absent-branch run.
      env: {
        ...process.env,
        PATH: `${shimDir}:${process.env.PATH}`,
        VMARK_UI_PHASE_NO_DEVDOCS: "0",
      },
    });
  }

  it.runIf(MAINTAINER_TREE)("phase 4 maintainer branch asserts the real doc", () => {
    const res = runMaintainer("4");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("dev-docs/design-system.md exists");
  });

  it.runIf(MAINTAINER_TREE)("phase 0 maintainer branch asserts the visual-QA fixtures", () => {
    const res = runMaintainer("0");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("visual-QA reference doc exists");
    expect(res.stdout).toContain("baseline screenshot night exists");
  });

  it("phase 0 reports every gate wiring assertion", () => {
    const res = run("0");
    // The wiring half of phase 0 is landed; the run() override always skips
    // the dev-docs fixture block (see run above). Assert the wiring
    // assertions RAN, and that none of them failed.
    expect(res.stdout).toContain("lint:theme-contrast npm entry");
    expect(res.stdout).not.toMatch(/✗ .*npm entry/);
    expect(res.stdout).not.toMatch(/✗ .*registered/);
  });
});
