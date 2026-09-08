// WI-UI0.5 — self-test for the UI-consistency plan's DoD script.
/**
 * The script asserts tree state per phase; these tests pin its own mechanics
 * so a broken assertion helper cannot report a phase green (rule: green is not
 * evidence that anything happened).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A `pnpm` shim: the WIRING assertions are this test's subject; the real gates
// and test files the script re-runs have their own self-tests in this same
// tier, and running them again here made the test time out under
// check:predelta's 8-way pool. The shim exits 0 and, for the test-run
// assertions (which read vitest's JSON report, not the exit code), writes the
// report `assert_test_run` asks for through `--outputFile=`.
function shimWith(report, exitCode = 0) {
  const dir = mkdtempSync(path.join(tmpdir(), "ui-phase-shim-"));
  writeFileSync(
    path.join(dir, "pnpm"),
    `#!/bin/sh\nfor a in "$@"; do case "$a" in --outputFile=*) printf '%s' '${JSON.stringify(report)}' > "\${a#--outputFile=}";; esac; done\nexit ${exitCode}\n`,
  );
  chmodSync(path.join(dir, "pnpm"), 0o755);
  return dir;
}
// Per-suite entries, the way vitest's JSON reporter writes them — BY NAME:
// `assert_test_run` requires every suite a filter matches ON DISK to appear in
// the report under its own path, because a count alone accepts a
// same-sized-but-different set (audit 20260907 #66, audit R2 #97).
const A11Y_ON_DISK = readdirSync(path.join(REPO, "src"), { recursive: true })
  .filter((f) => String(f).endsWith(".a11y.test.tsx"))
  .map((f) => `src/${String(f).split(path.sep).join("/")}`)
  .sort();
// Every literal path the phases name through assert_test_run; one report
// serves every invocation of the shim.
const NAMED_SUITES = [
  "scripts/check-theme-contrast.test.ts",
  "scripts/check-ui-consistency.test.mjs",
  "scripts/check-theme-names.test.mjs",
  "src/test/reducedMotionGlobal.test.ts",
];
const suite = (name, ...statuses) => ({ name, status: "passed", assertionResults: statuses.map((status) => ({ status })) });
const GREEN = {
  numTotalTestSuites: 1, numFailedTestSuites: 0, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0,
  testResults: [...NAMED_SUITES, ...A11Y_ON_DISK].map((name) => suite(name, "passed")),
};
const shimDir = shimWith(GREEN);

function run(...args) {
  return runWithShim(shimDir, ...args);
}
function runWithShim(shim, ...args) {
  return spawnSync("bash", ["scripts/check-ui-phase.sh", ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${shim}:${process.env.PATH}`,
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

  // audit R2 #91 — a second positional was discarded in silence, so
  // `check-ui-phase.sh 2 3` ran phase 2 and said nothing about the 3.
  it("exits 64 on a second positional argument instead of ignoring it", () => {
    const extra = run("2", "3");
    expect(extra.status).toBe(64);
    expect(extra.stdout).toContain("unexpected extra argument: 3");
  });

  // audit R2 #98 — the theme list was written out twice (phase 0's baseline
  // screenshots, phase 1's contrast lists), so a seventh theme would have been
  // covered by whichever phase somebody remembered. One array, and it is
  // CHECKED against the contrast baseline, whose keys the typed catalog writes.
  it("declares exactly one theme list, and it matches the contrast baseline", () => {
    const src = readFileSync(path.join(REPO, "scripts/check-ui-phase.sh"), "utf8");
    const declarations = [...src.matchAll(/^THEMES=\(([^)]*)\)/gm)];
    expect(declarations).toHaveLength(1);
    const themes = declarations[0][1].trim().split(/\s+/).sort();
    // No second copy left behind as a literal loop.
    expect(src).not.toMatch(/for theme in [a-z]/);
    const baseline = JSON.parse(readFileSync(path.join(REPO, "scripts/theme-contrast-baseline.json"), "utf8"));
    expect(themes).toEqual(Object.keys(baseline.failing).sort());
    // And the script says so itself, on the phases that consume the list.
    expect(run("0").stdout).toContain("✓ theme list matches the contrast baseline's themes");
    expect(run("1").stdout).toContain("✓ theme list matches the contrast baseline's themes");
  });

  // audit R2 #93 — `assert_cmd` discarded the gate's output, so a red gate
  // reported "command failed: pnpm lint:ui-consistency" and nothing else, for
  // a gate whose whole job is to name the offending file and line.
  it("prints a bounded tail of a failing gate's own output", () => {
    const noisy = mkdtempSync(path.join(tmpdir(), "ui-phase-noisy-"));
    writeFileSync(
      path.join(noisy, "pnpm"),
      "#!/bin/sh\ni=1\nwhile [ $i -le 40 ]; do echo \"noise $i\"; i=$((i+1)); done\necho 'src/x.css:12 the real finding'\nexit 4\n",
    );
    chmodSync(path.join(noisy, "pnpm"), 0o755);
    const res = runWithShim(noisy, "3");
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("✗ lint:ui-consistency green (exit 4:");
    expect(res.stdout).toContain("| src/x.css:12 the real finding");
    expect(res.stdout).not.toContain("| noise 1\n");
  });

  // audit R2 #95 — the vitest JSON report was removed only on the normal path.
  // A private TMPDIR proves the successful path cleans up; the trap lines are
  // what cover the interrupt, which a test cannot time reliably.
  it("leaves no temporary file behind, and traps the interrupt paths too", () => {
    const priv = mkdtempSync(path.join(tmpdir(), "ui-phase-tmp-"));
    const res = spawnSync("bash", ["scripts/check-ui-phase.sh", "1"], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}`, VMARK_UI_PHASE_NO_DEVDOCS: "1", TMPDIR: priv },
    });
    expect(res.status, res.stdout).toBe(0);
    expect(readdirSync(priv)).toEqual([]);
    const src = readFileSync(path.join(REPO, "scripts/check-ui-phase.sh"), "utf8");
    expect(src).toContain("trap cleanup_temp EXIT");
    expect(src).toMatch(/trap '.*cleanup_temp.*' INT/);
    expect(src).toMatch(/trap '.*cleanup_temp.*' TERM/);
  });

  it("phase 4 is GREEN now that its artifacts landed (the flip its DoD required)", () => {
    // Until WI-UI4.x landed, this test pinned the fail-closed direction (red
    // with the missing paths named). The flip to green IS part of the DoD.
    const res = run("4");
    expect(res.status, res.stdout + res.stderr).toBe(0);
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

  it("phase 4 stays green while a sibling test's transient dev-docs fixture exists", () => {
    // clean-dev.test.mjs creates dev-docs/grills/… in the REAL repo root and
    // removes it in afterEach; on a tree with no dev-docs (CI, fresh worktree)
    // that window overlaps this tier's parallel pool. A markerless dev-docs is
    // a fixture, not a maintainer tree — the probe keys on dev-docs/README.md.
    // Directly under dev-docs/, NOT under dev-docs/grills/: clean-dev's own
    // "no-op when grills is absent" test early-returns whenever grills
    // exists, and a probe inside grills would make it skip silently.
    //
    // runMaintainer, not run: run() forces the absent branch via
    // VMARK_UI_PHASE_NO_DEVDOCS=1, which would green this test without ever
    // exercising the README-marker probe it exists to pin.
    const probe = path.join(REPO, "dev-docs/__ui-phase-race-probe__");
    mkdirSync(probe, { recursive: true });
    try {
      const res = runMaintainer("4");
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
    // The wiring half of phase 0 is landed; the run() override always skips
    // the dev-docs fixture block (see run above). Assert the wiring
    // assertions RAN, and that none of them failed.
    expect(res.stdout).toContain("lint:theme-contrast npm entry");
    expect(res.stdout).not.toMatch(/✗ .*npm entry/);
    expect(res.stdout).not.toMatch(/✗ .*registered/);
  });

  // Audit 20260907 #63/#65/#66: the named test files used to satisfy the
  // phase by existing. They are RUN now, and the verdict comes from the JSON
  // report — so a report with no passing test, or with a failure, is red.
  it("runs the named tests and reads the report: green passes, no-pass and failing reports fail", () => {
    const green = run("1");
    expect(green.stdout).toContain("✓ reduced-motion global test runs green");
    const skipped = runWithShim(shimWith({ ...GREEN, numPassedTests: 0, numTotalTests: 0, testResults: [] }), "1");
    expect(skipped.status).toBe(1);
    expect(skipped.stdout).toContain("✗ reduced-motion global test did not run green");
    expect(skipped.stdout).toContain("src/test/reducedMotionGlobal.test.ts did not run");
    const red = runWithShim(shimWith({ ...GREEN, numFailedTests: 1, testResults: [...GREEN.testResults, suite("src/x.a11y.test.tsx", "passed", "failed")] }), "4");
    expect(red.status).toBe(1);
    expect(red.stdout).toContain("✗ a11y axe suites (every *.a11y.test.tsx) did not run green");
    expect(red.stdout).toContain("x.a11y.test.tsx: 1 failed test(s)");
  });

  // audit R2 #96 — the verdict used to come from the report ALONE, so a run
  // that wrote a green report and then died was reported as successful.
  it("fails when vitest exits non-zero even though the report looks green", () => {
    const crashed = runWithShim(shimWith(GREEN, 7), "1");
    expect(crashed.status).toBe(1);
    expect(crashed.stdout).toContain("vitest exited 7");
  });

  // Audit 20260907 #66, second half: the verdict is PER SUITE. One suite whose
  // every case is skipped reports `status: "passed"` with only skipped
  // assertions, and the run's totals stay green on its siblings' account.
  it("a single all-skipped suite among green ones is red, named, and so is a suite the filter never ran", () => {
    const quiet = A11Y_ON_DISK[0];
    const oneSkipped = runWithShim(
      shimWith({ ...GREEN, testResults: [...GREEN.testResults.filter((t) => t.name !== quiet), suite(quiet, "skipped")] }),
      "4",
    );
    expect(oneSkipped.status).toBe(1);
    expect(oneSkipped.stdout).toContain(`${quiet}: no passing test (skipped)`);
    // audit R2 #97 — a same-SIZED but different set used to pass: the missing
    // suite is named now, not counted.
    const swapped = runWithShim(
      shimWith({ ...GREEN, testResults: [...GREEN.testResults.filter((t) => t.name !== quiet), suite("src/stand-in.a11y.test.tsx", "passed")] }),
      "4",
    );
    expect(swapped.status).toBe(1);
    expect(swapped.stdout).toContain(`${quiet} did not run`);
    const phase0 = run("0");
    expect(phase0.stdout).toContain("✓ check-theme-contrast self-test runs green");
    expect(phase0.stdout).toContain("✓ check-theme-names self-test runs green");
  });
});
