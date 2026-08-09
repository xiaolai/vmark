#!/usr/bin/env node
/**
 * Gate liveness — does every scheduled gate still produce verdicts? (WI-AF2.4)
 *
 * THE DEFECT THIS EXISTS FOR. `tier0-e2e.yml` was merged 2026-08-04 and had run
 * ZERO times when it was examined five days later. It reviewed clean, it was
 * wired correctly, and it protected nothing — the six Tier-0 journeys it was
 * supposed to guard had in fact been broken since 2026-08-07 and nothing said
 * so. `mutation.yml` is the same defect with a longer history: seven scheduled
 * runs killed by their own 60-minute timeout, which GitHub reports as
 * `cancelled` — a word that reads like an operator action and went unexamined
 * for two months — plus one run whose conclusion was SUCCESS while its only
 * job's was FAILURE.
 *
 * A gate that has stopped producing verdicts is indistinguishable, from the
 * outside, from a gate that is passing. This is the thing that tells them apart.
 *
 * DISCOVERY IS BY MARKER, not by a list here. A workflow opts in with three
 * comment lines:
 *
 *     # liveness-gate: true
 *     # cadence-days: 8
 *     # on-failure: rolling-issue
 *
 * A hand-maintained list would be a second place to keep in sync, and it drifts
 * the first time someone adds a workflow — the exact failure mode that left
 * `gha-tdd-guard.mjs` pointing at four paths that had not existed for months.
 * The marker cannot drift from the workflow because it is IN the workflow.
 *
 * WHO WATCHES THIS ONE. Nothing can watch itself: a scheduled workflow that
 * stops firing is not there to report its own silence. `gate-liveness.yml`
 * checks every other marked gate; `baseline-review.yml`, on a different day,
 * runs this script with `--only gate-liveness.yml`. Mutual watchers on
 * non-identical schedules — asserted by this script's test, because a sentence
 * in a header is documentation, not supervision.
 *
 * Usage:
 *   node scripts/check-gate-liveness.mjs [--workflows=<dir>] [--today=YYYY-MM-DD]
 *   node scripts/check-gate-liveness.mjs --only <workflow-file>
 *   node scripts/check-gate-liveness.mjs --list      # declarations only, no API
 *
 * Exit codes: 0 every gate live · 1 a gate is silent, stale, or unverifiable
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const flag = (name, fallback = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const WF_DIR = flag("workflows", path.join(ROOT, ".github/workflows"));
const LIST_ONLY = process.argv.includes("--list");
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null;

/** Grace multiplier: a gate is late only once it has missed a whole cycle. */
const GRACE = 1.5;

/** Parse the three marker lines out of a workflow's comments. */
function declaration(file, text) {
  if (!/^\s*#\s*liveness-gate:\s*true\s*$/m.test(text)) return null;
  const cadence = text.match(/^\s*#\s*cadence-days:\s*(\d+)\s*$/m);
  const onFailure = text.match(/^\s*#\s*on-failure:\s*(\S+)\s*$/m);
  return {
    file,
    cadenceDays: cadence ? Number(cadence[1]) : null,
    onFailure: onFailure ? onFailure[1] : null,
  };
}

let gates = readdirSync(WF_DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((f) => declaration(f, readFileSync(path.join(WF_DIR, f), "utf8")))
  .filter(Boolean)
  .sort((a, b) => a.file.localeCompare(b.file));

if (ONLY) gates = gates.filter((g) => g.file === ONLY);

const failures = [];

// An incomplete declaration is a failure, not a default. A cadence nobody chose
// is a threshold nobody can be held to.
for (const g of gates) {
  if (!Number.isInteger(g.cadenceDays) || g.cadenceDays <= 0) {
    failures.push(`${g.file}: marked as a liveness gate but declares no valid \`# cadence-days:\``);
  }
  if (!g.onFailure) {
    failures.push(`${g.file}: marked as a liveness gate but declares no \`# on-failure:\` path`);
  }
}

if (LIST_ONLY) {
  for (const g of gates) {
    console.log(`${g.file}\tcadence=${g.cadenceDays}d\ton-failure=${g.onFailure}`);
  }
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

if (gates.length === 0) {
  console.log("0 liveness gates declared — nothing to check");
  process.exit(0);
}

const today = flag("today") ? new Date(`${flag("today")}T00:00:00Z`) : new Date();
if (Number.isNaN(today.getTime())) {
  console.error(`--today=${flag("today")} is not a date`);
  process.exit(1);
}

/**
 * A VERDICT is a completed run that concluded success or failure. `cancelled`
 * and `skipped` are not verdicts — that distinction is the entire mutation.yml
 * story, where seven timeouts wearing the word "cancelled" read as healthy.
 */
const isVerdict = (r) =>
  r?.status === "completed" && (r?.conclusion === "success" || r?.conclusion === "failure");

let bad = 0;
for (const g of gates) {
  const gh = spawnSync(
    "gh",
    ["api", `repos/{owner}/{repo}/actions/workflows/${g.file}/runs?per_page=30`],
    { encoding: "utf8" },
  );
  if (gh.error || gh.status !== 0) {
    // GitHub 404s a workflow it has no record of. For a file that is not yet on
    // the DEFAULT BRANCH that is expected and temporary — it cannot have run,
    // because it does not exist anywhere GitHub schedules from. For a file that
    // IS on the default branch, the same 404 is the F1 state wearing a
    // different error code, and must be loud.
    //
    // Deciding by "is it merged" rather than by the status code keeps this from
    // becoming an excuse: the exemption evaporates the moment the workflow
    // lands, with no list to update and nothing to remember.
    // The exemption is granted only on POSITIVE evidence of absence: this must
    // be the repo's own workflow directory, a default-branch ref must resolve,
    // and the file must be missing from it. Anything else — no git, no remote,
    // a fixture tree — falls through to the failure below, because "I could not
    // determine whether this is merged" is not a reason to pass. Inverting that
    // default would let every fail-closed case buy silence by being unreadable.
    const isRealWfDir = path.resolve(WF_DIR) === path.join(ROOT, ".github/workflows");
    const baseRef = ["origin/HEAD", "origin/main"].find(
      (r) => spawnSync("git", ["rev-parse", "--verify", r], { cwd: ROOT }).status === 0,
    );
    const pendingRegistration =
      isRealWfDir &&
      Boolean(baseRef) &&
      spawnSync("git", ["cat-file", "-e", `${baseRef}:.github/workflows/${g.file}`], { cwd: ROOT })
        .status !== 0;
    if (pendingRegistration) {
      console.log(
        `  · ${g.file}: not on the default branch yet — GitHub has no record of it, ` +
          `which is expected until it merges`,
      );
      continue;
    }
    // FAIL CLOSED. A liveness checker that goes quiet when it cannot see is
    // precisely the condition it exists to detect.
    console.error(`  ✗ ${g.file}: could not read run history (${gh.error ? "gh unavailable" : "gh api failed"})`);
    bad += 1;
    continue;
  }
  let runs;
  try {
    runs = JSON.parse(gh.stdout).workflow_runs;
    if (!Array.isArray(runs)) throw new Error("workflow_runs is not an array");
  } catch (err) {
    console.error(`  ✗ ${g.file}: run history was not parseable JSON (${err.message})`);
    bad += 1;
    continue;
  }

  const verdicts = runs.filter(isVerdict);
  if (verdicts.length === 0) {
    const seen = runs.length === 0 ? "it has NEVER run" : `${runs.length} run(s), none of which reached a verdict`;
    console.error(
      `  ✗ ${g.file}: no verdict on record — ${seen}. ` +
        `A workflow that exists and never concludes protects nothing.`,
    );
    bad += 1;
    continue;
  }

  const latest = verdicts
    .map((r) => new Date(r.updated_at))
    .sort((a, b) => b - a)[0];
  const ageDays = (today - latest) / 86_400_000;
  const limit = g.cadenceDays * GRACE;
  if (ageDays > limit) {
    console.error(
      `  ✗ ${g.file}: last verdict ${ageDays.toFixed(1)}d ago, cadence is ${g.cadenceDays}d ` +
        `(limit ${limit.toFixed(1)}d with grace) — it has stopped producing verdicts`,
    );
    bad += 1;
    continue;
  }
  console.log(`  ✓ ${g.file}: last verdict ${ageDays.toFixed(1)}d ago (cadence ${g.cadenceDays}d)`);
}

if (bad > 0) {
  console.error(`\n${bad} of ${gates.length} liveness gate(s) are not producing verdicts.`);
  process.exit(1);
}
console.log(`\n✅ all ${gates.length} liveness gate(s) are producing verdicts`);
process.exit(0);
