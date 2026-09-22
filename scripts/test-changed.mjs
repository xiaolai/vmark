#!/usr/bin/env node
/**
 * Purpose: run the tests related to the working tree's changes — across BOTH
 *   default tiers, not just the app one.
 *
 * `vitest run --changed` resolves against a single config. Wired to the app
 * tier alone (which is what `test:changed` used to be), editing a lint gate
 * under `scripts/` produced a green `check:fast` having run no gate self-test
 * at all — the fast loop reported success on precisely the change it had not
 * checked.
 *
 * So: always run the app tier's changed set, and additionally run the gate tier
 * when a gate file changed. The gate tier is NOT `--changed`-filtered, because
 * its ~30 files take ~35s in total and its subjects are the scripts themselves
 * — the import graph would miss a gate whose behaviour is exercised through a
 * spawned subprocess, which is how every one of them works.
 *
 * This does not close the loop's other documented blind spots (see AGENTS.md):
 * `--changed` still follows the static import graph, so a test that reads its
 * subject at runtime with `readFileSync` is invisible to it.
 *
 * @coordinates-with package.json — `test:changed`, used by `check:fast`
 * @coordinates-with vitest.gates.config.ts — the tier conditionally added here;
 *   GATE_PREFIXES must cover its include roots (pinned by test-changed.test.mjs)
 * @module scripts/test-changed
 */
import { spawnSync } from "node:child_process";

const BASE = process.env.VMARK_CHANGED_BASE ?? "origin/main";

/**
 * Paths whose tests live in the gate tier rather than the app tier.
 *
 * MUST cover every root in `vitest.gates.config.ts`'s `include`, or a change
 * under a root this list forgets selects no tests at all and still reports
 * green — the exact failure this script was written to stop, one root further
 * along. `scripts/test-changed.test.mjs` derives the tier's roots from that
 * config and fails if the two disagree, in either direction.
 */
// NOT exported: this module runs vitest at import time, so its self-test reads
// the literal below as TEXT rather than importing it.
//
// The last three entries are FILES, not roots, and they are the gate tier's own
// configuration. Editing `vitest.gates.config.ts` decides what that tier runs,
// yet a root-prefix-only list selected no gate tests for it — a change to the
// selector's own subject running nothing, while `check:fast` reported green.
// `vitest.shared.ts` is the same one hop out: every tier's worker count and
// extension set come from it.
const GATE_PREFIXES = [
  "scripts/",
  ".claude/hooks/",
  "e2e/",
  "vitest.gates.config.ts",
  "vitest.shared.ts",
];

function run(label, args) {
  process.stdout.write(`\n▶ ${label}\n`);
  const res = spawnSync("pnpm", args, { stdio: "inherit" });
  if (res.error) {
    console.error(`Failed to start: ${res.error.message}`);
    return 1;
  }
  // A signal death is a failure even though `status` is null.
  return res.status ?? 1;
}

/**
 * Files that are new and not yet committed. `git diff` cannot see them — it
 * compares COMMITS — so a brand-new file was invisible to this selector, which
 * is the worst case for it to miss: nothing has ever run that file's tests, and
 * the run still printed "gate tier skipped". Found live when
 * `scripts/check-release-updater-targets.test.mjs` was added and the gate tier
 * did not run. `--exclude-standard` honours .gitignore, so build output and
 * `dev-docs/` do not select anything.
 *
 * This is needed for the GATE-TIER decision only. vitest's own `--changed`
 * already picks untracked files up, so the app tier above never had the hole —
 * measured, not assumed, before narrowing the fix to here.
 */
function untrackedFiles() {
  const res = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  // A failure here is not fatal the way an unresolvable base is: the tracked
  // diff is still meaningful. Report it rather than pretending the tree is
  // clean, since the consequence is under-selection.
  if (res.status !== 0) {
    console.error("test-changed: could not list untracked files — new files may not be selected.");
    return [];
  }
  return res.stdout.split("\n").filter(Boolean);
}

function changedFiles() {
  const res = spawnSync("git", ["diff", "--name-only", BASE], { encoding: "utf8" });
  if (res.status !== 0) {
    // Fail loud rather than silently skipping the gate tier: an unresolvable
    // base is the case where "no gate files changed" is least trustworthy.
    console.error(
      `test-changed: could not diff against ${BASE} — fetch it first, or set ` +
        `VMARK_CHANGED_BASE. Running BOTH tiers rather than guessing.`,
    );
    return null;
  }
  return [...new Set([...res.stdout.split("\n").filter(Boolean), ...untrackedFiles()])];
}

const changed = changedFiles();
const gatesTouched =
  changed === null || changed.some((f) => GATE_PREFIXES.some((p) => f.startsWith(p)));

// An unresolvable base cannot be handed to `--changed`: vitest fails to resolve
// it and the app tier errors WITHOUT running anything, which is the opposite of
// the "running BOTH tiers rather than guessing" the message above promises.
// Run the whole app tier instead — that is what "not guessing" means here.
let exit =
  changed === null
    ? run("app tier (FULL — base unresolvable)", ["vitest", "run", "--passWithNoTests"])
    : run("app tier (changed)", [
        "vitest", "run", `--changed=${BASE}`, "--passWithNoTests",
      ]);

if (gatesTouched) {
  exit = run("gate tier (a gate file changed)", [
    "vitest", "run", "--config", "vitest.gates.config.ts",
  ]) || exit;
} else {
  process.stdout.write(
    `\n▶ gate tier skipped — no change under ${GATE_PREFIXES.join(", ")}\n`,
  );
}

process.exit(exit);
