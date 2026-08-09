#!/usr/bin/env node
/**
 * Change-size forcing function (WI-AF4.1, finding F4).
 *
 * A PR whose diff exceeds either threshold in scripts/change-size-policy.json
 * must carry the acknowledgement token in its body. Thresholds are the measured
 * p90 of this repo's own merge history — see that file for the distribution.
 *
 * WHAT THIS IS AND IS NOT. `main` requires 0 approving reviews, so the token is
 * added by the same person who wrote the PR. This gate therefore prevents
 * nothing; it converts an unremarked accident into a recorded decision, and puts
 * the number where a human and a future audit can see it. Overselling it as a
 * control would be the kind of fiction this plan exists to delete. See
 * .claude/rules/60-ai-governance.md §13.
 *
 * Motivating case: the 2026-08-03 architecture review landed as ONE commit of
 * 652 files (+33,935/−6,466) against its own plan's "no big-bang commit"
 * criterion. Nothing objected, because nothing was watching the size.
 *
 * WHY PR-TIER, NOT check:all — it needs a base ref and a PR body, neither of
 * which a local checkout can guarantee (detached HEAD, stale remote, shallow
 * clone, no network). Same tier and posture as check-new-deps.sh.
 *
 * WHY THE BODY COMES FROM `gh api` — `pull_request` in ci.yml declares no
 * `types:`, so it fires on opened/synchronize/reopened and NOT on edited. A
 * token added to the body after a red check would never re-trigger, and a
 * re-run replays the original event payload. Reading the body live is what
 * makes the documented remedy actually work.
 *
 * ONE SCRIPT, NOT A SHELL WRAPPER. This began as bash calling `node -e`. Node 24
 * evaluates `-e` through its TypeScript parser, which rejected a regex literal
 * that is valid JavaScript, and `read` returned non-zero at EOF on unterminated
 * output while having already assigned every variable. Both were hazards of the
 * shell/node boundary rather than of the logic; deleting the boundary deleted
 * them.
 *
 * Usage:  node scripts/check-change-size.mjs [base-ref]
 * Env:    GITHUB_PR_NUMBER — the PR whose body carries the acknowledgement
 *
 * Exit codes:
 *   0  under threshold, or over threshold and acknowledged
 *   1  over threshold and NOT acknowledged
 *  64  bad invocation / unresolvable base / unreadable body while over
 *      threshold — FAIL CLOSED, never a silent pass over an unmeasured change
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const POLICY_PATH = "scripts/change-size-policy.json";
if (!existsSync(POLICY_PATH)) {
  console.error(`missing ${POLICY_PATH}`);
  process.exit(64);
}
const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
const { maxFiles, maxLines, acknowledgement } = policy;
if (!Number.isFinite(maxFiles) || !Number.isFinite(maxLines) || !acknowledgement) {
  console.error(`${POLICY_PATH} is missing maxFiles / maxLines / acknowledgement`);
  process.exit(64);
}

const git = (...args) => spawnSync("git", args, { encoding: "utf8" });

/** Resolve the base ref, refusing to guess when it cannot be verified. */
function resolveBase(explicit) {
  const candidates = explicit ? [explicit] : ["origin/main", "main"];
  for (const c of candidates) {
    if (git("rev-parse", "--verify", c).status === 0) return c;
  }
  return null;
}

const base = resolveBase(process.argv[2]);
if (!base) {
  console.error(
    `could not resolve a base ref (tried: ${process.argv[2] ?? "origin/main, main"}) — refusing to guess`,
  );
  process.exit(64);
}

const mb = git("merge-base", base, "HEAD");
const mergeBase = mb.status === 0 ? mb.stdout.trim() : base;

/**
 * Glob → RegExp. Deliberately simple: `**` spans separators, `*` does not.
 * The policy file is ours, so a glob dependency would be bought to parse the
 * handful of patterns we wrote.
 */
function toRegExp(pattern) {
  // Tokenise, do not escape-then-substitute. The first version escaped every
  // metacharacter EXCEPT `*`, then looked for ESCAPED asterisks that could
  // therefore never appear — so `**/generated/**` reached RegExp verbatim and
  // threw "Nothing to repeat". Splitting on the wildcards first means the
  // literal segments are the only thing escaped and the wildcards the only
  // thing expanded.
  const escapeLiteral = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = pattern
    .split("**")
    .map((between) => between.split("*").map(escapeLiteral).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${body}$`);
}
const excluded = (policy.excludePaths ?? []).map(toRegExp);

const diff = git("diff", "--numstat", mergeBase, "HEAD");
if (diff.status !== 0) {
  console.error(`could not measure the diff: ${diff.stderr.trim()}`);
  process.exit(64);
}

let files = 0;
let lines = 0;
for (const row of diff.stdout.split("\n")) {
  const parts = row.split("\t");
  if (parts.length !== 3) continue;
  const [added, deleted, file] = parts;
  if (excluded.some((r) => r.test(file))) continue;
  files += 1;
  // "-" is git's binary notation: one changed file, no countable lines.
  lines += (/^\d+$/.test(added) ? Number(added) : 0) + (/^\d+$/.test(deleted) ? Number(deleted) : 0);
}

const within = files <= maxFiles && lines <= maxLines;
if (within) {
  console.log(`✅ change size ${files} files / ${lines} lines (limits ${maxFiles}/${maxLines})`);
  process.exit(0);
}

// Over threshold. From here the PR body is REQUIRED, so every way of failing to
// read it is an error rather than a pass. An under-threshold change never
// reaches this point, which is why a small PR does not depend on API access.
const pr = process.env.GITHUB_PR_NUMBER?.trim();
if (!pr) {
  console.error(
    `::error::change is ${files} files / ${lines} lines (limits ${maxFiles}/${maxLines}) ` +
      `and no PR number is available to read an acknowledgement from`,
  );
  process.exit(64);
}

const gh = spawnSync("gh", ["api", `repos/{owner}/{repo}/pulls/${pr}`, "--jq", ".body"], {
  encoding: "utf8",
});
if (gh.error || gh.status !== 0) {
  console.error(
    "::error::change is over the size limits and the PR body could not be read " +
      `(${gh.error ? "gh unavailable" : "gh api failed"}) — failing closed`,
  );
  process.exit(64);
}

if ((gh.stdout ?? "").includes(acknowledgement)) {
  console.log(
    `✅ change size ${files} files / ${lines} lines — over limits (${maxFiles}/${maxLines}) and acknowledged`,
  );
  process.exit(0);
}

console.error(
  `::error::This PR changes ${files} files / ${lines} lines, over the limits of ` +
    `${maxFiles} files / ${maxLines} lines.

That is not forbidden — large changes are sometimes right. It has to be a
decision someone made on purpose rather than one nobody noticed.

Add a line to the PR body saying so:

    ${acknowledgement}: <why this change is this size>

Or split the PR. Thresholds are the measured p90 of this repo's own history;
see ${POLICY_PATH}.`,
);
process.exit(1);
