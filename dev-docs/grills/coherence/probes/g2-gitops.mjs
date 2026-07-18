#!/usr/bin/env node
/**
 * Gate G2 probe — git operation classification (WI-0.4, R18, paper §8).
 *
 * Validates that "navigation vs. mutation" can be decided purely from
 * before/after observation of a workspace (scan-time reconciliation), with
 * NO events from inside .git — VMark's watcher (src-tauri/src/watcher.rs,
 * IGNORED_DIRS) ignores `.git`, so .git/HEAD inotify is not available.
 *
 * All probe repos are created in fresh mkdtemp temp directories; nothing
 * touches the vmark repo. Zero npm deps. Results: g2-results.json.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROBE_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = path.join(PROBE_DIR, "g2-results.json");
const KEEP = process.env.KEEP === "1";
const tempDirs = [];

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull, // isolate from user config (signing, hooks)
  GIT_CONFIG_SYSTEM: os.devNull,
  GIT_AUTHOR_NAME: "probe",
  GIT_AUTHOR_EMAIL: "probe@example.invalid",
  GIT_COMMITTER_NAME: "probe",
  GIT_COMMITTER_EMAIL: "probe@example.invalid",
};

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function tryGit(cwd, ...args) {
  try { return git(cwd, ...args); } catch { return null; }
}
function mktemp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

/** Resolve the per-worktree gitdir manually: `.git` may be a directory
 * (primary worktree) or a file `gitdir: <path>` (linked worktree). */
function resolveGitDir(dir) {
  const dotGit = path.join(dir, ".git");
  let st;
  try { st = fs.statSync(dotGit); } catch { return null; }
  if (st.isDirectory()) return dotGit;
  const m = fs.readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+?)\s*$/m);
  return m ? path.resolve(dir, m[1]) : null;
}
function readGitFile(gitDir, name) {
  try { return fs.readFileSync(path.join(gitDir, name), "utf8").trim(); } catch { return null; }
}

/** Fingerprint of worktree file contents (excluding .git) — demonstrates
 * whether git changed working files, using only ordinary fs observation. */
function treeFingerprint(dir) {
  const parts = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else parts.push(`${path.relative(dir, p)}:${fs.readFileSync(p, "utf8").length}:${fs.readFileSync(p)}`);
    }
  })(dir);
  return parts.join("\n");
}

/** Scan-time observation of a workspace directory. Pure before/after state;
 * no .git event stream required. */
function observe(dir) {
  const gitDir = resolveGitDir(dir);
  const isGit = gitDir !== null && tryGit(dir, "rev-parse", "--git-dir") !== null;
  if (!isGit) return { isGit: false, dir };
  const headRaw = readGitFile(gitDir, "HEAD"); // manual read incl. worktree indirection
  const headSha = tryGit(dir, "rev-parse", "HEAD");
  const symbolic = tryGit(dir, "symbolic-ref", "-q", "HEAD");
  const allShas = (tryGit(dir, "rev-list", "--all", "HEAD") ?? "").split("\n").filter(Boolean);
  return {
    isGit: true,
    dir,
    gitDir,
    headRaw,
    headSha,
    headRef: symbolic, // null when detached
    detached: symbolic === null,
    allShas,
    mergeHead: readGitFile(gitDir, "MERGE_HEAD"),
    origHead: readGitFile(gitDir, "ORIG_HEAD"),
    reflogSubject: tryGit(dir, "reflog", "-1", "--format=%gs"),
    tree: treeFingerprint(dir),
  };
}

/**
 * CANDIDATE CLASSIFIER (R18): decide from two scan-time observations only.
 *  - NOT_GIT            → workspace has no repo; all changes are ordinary external edits
 *  - MERGE_IN_PROGRESS  → MERGE_HEAD exists; git rewrote files (conflict markers)
 *                         but minted no commit yet; defer capture until it concludes
 *  - MUTATION           → HEAD landed on a commit sha that did NOT exist before
 *                         (revert, merge commit): real new content, attributed to git
 *  - NAVIGATION         → HEAD landed on a sha that already existed before
 *                         (checkout, branch switch, reset --hard, detach, FF merge):
 *                         no new content minted; never mint revisions
 *  - NO_OP              → identical HEAD sha and raw HEAD content
 *  - EXTERNAL_UNKNOWN   → HEAD sha unknown to the before-observation (e.g. fetch
 *                         from elsewhere + checkout): scan-reconcile as external
 */
function classify(before, after) {
  if (!after.isGit) return "NOT_GIT";
  if (after.mergeHead) return "MERGE_IN_PROGRESS";
  const beforeSet = new Set(before.isGit ? before.allShas : []);
  const created = after.allShas.filter((s) => !beforeSet.has(s));
  if (after.headSha && created.includes(after.headSha)) return "MUTATION";
  if (after.headSha && beforeSet.has(after.headSha)) {
    if (after.headSha === before.headSha && after.headRaw === before.headRaw) return "NO_OP";
    return "NAVIGATION";
  }
  return "EXTERNAL_UNKNOWN";
}

/** Fresh repo with three commits on main touching story.md (+ side.md). */
function makeRepo() {
  const dir = mktemp("vmark-g2-");
  git(dir, "init", "-q", "-b", "main");
  const shas = [];
  for (let i = 1; i <= 3; i++) {
    fs.writeFileSync(path.join(dir, "story.md"), `# Story\n\nrevision ${i}\n`);
    if (i === 1) fs.writeFileSync(path.join(dir, "side.md"), "side v1\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", `c${i}`);
    shas.push(git(dir, "rev-parse", "HEAD"));
  }
  return { dir, shas };
}

const rows = [];
function record(scenario, expected, before, after, extra = {}) {
  const observed = classify(before, after);
  rows.push({
    scenario,
    expected,
    observed,
    pass: observed === expected,
    observables: after.isGit ? {
      headRefBefore: before.headRef ?? (before.detached ? "(detached)" : null),
      headRefAfter: after.headRef ?? (after.detached ? "(detached)" : null),
      headShaMoved: before.headSha !== after.headSha,
      newShasMinted: after.allShas.filter((s) => !new Set(before.allShas ?? []).has(s)).length,
      filesChangedByOp: before.tree !== after.tree,
      origHeadAfter: after.origHead,
      reflogSubject: after.reflogSubject,
      detachedAfter: after.detached,
    } : { isGit: false },
    ...extra,
  });
}

// --- 1. checkout of an older commit (detached HEAD) ---
{
  const { dir, shas } = makeRepo();
  const before = observe(dir);
  git(dir, "checkout", "-q", shas[0]);
  record("checkout-older-commit-detached", "NAVIGATION", before, observe(dir));
}

// --- 2. branch create + switch (no content change) ---
{
  const { dir } = makeRepo();
  const before = observe(dir);
  git(dir, "switch", "-q", "-c", "feature");
  record("branch-create-and-switch", "NAVIGATION", before, observe(dir));
}

// --- 3. reset --hard to older commit ---
{
  const { dir } = makeRepo();
  const before = observe(dir);
  git(dir, "reset", "-q", "--hard", "HEAD~1");
  record("reset-hard-to-older", "NAVIGATION", before, observe(dir));
}

// --- 4. revert (new commit with new content) ---
{
  const { dir } = makeRepo();
  const before = observe(dir);
  git(dir, "revert", "--no-edit", "HEAD");
  record("revert", "MUTATION", before, observe(dir));
}

// --- 5. fast-forward merge ---
{
  const { dir } = makeRepo();
  git(dir, "switch", "-q", "-c", "b");
  fs.writeFileSync(path.join(dir, "story.md"), "# Story\n\nrevision 4 (on b)\n");
  git(dir, "commit", "-aqm", "c4-on-b");
  git(dir, "switch", "-q", "main");
  const before = observe(dir); // on main, before the merge
  git(dir, "merge", "-q", "b"); // fast-forward
  const after = observe(dir);
  record("fast-forward-merge", "NAVIGATION", before, after, {
    note: "HEAD landed on a pre-existing sha (b's tip) — no new content minted, " +
      "but working files changed to content this checkout never had. " +
      "Distinguishers vs. plain checkout: reflog subject + ORIG_HEAD set + branch ref unchanged but moved.",
  });
}

// --- 6. true merge commit, no conflict ---
{
  const { dir } = makeRepo();
  git(dir, "switch", "-q", "-c", "b");
  fs.writeFileSync(path.join(dir, "side.md"), "side v2 (on b)\n");
  git(dir, "commit", "-aqm", "side-on-b");
  git(dir, "switch", "-q", "main");
  fs.writeFileSync(path.join(dir, "story.md"), "# Story\n\nrevision 4 (on main)\n");
  git(dir, "commit", "-aqm", "story-on-main");
  const before = observe(dir);
  git(dir, "merge", "-q", "--no-edit", "b");
  const after = observe(dir);
  record("true-merge-no-conflict", "MUTATION", before, after, {
    mergeParents: git(dir, "rev-list", "-1", "--parents", "HEAD").split(" ").length - 1,
  });
}

// --- 7 + 8. merge with conflict: mid-conflict scan, then resolved commit ---
{
  const { dir } = makeRepo();
  git(dir, "switch", "-q", "-c", "b");
  fs.writeFileSync(path.join(dir, "story.md"), "# Story\n\nb's version\n");
  git(dir, "commit", "-aqm", "story-on-b");
  git(dir, "switch", "-q", "main");
  fs.writeFileSync(path.join(dir, "story.md"), "# Story\n\nmain's version\n");
  git(dir, "commit", "-aqm", "story-on-main");
  const before = observe(dir);
  let mergeFailed = false;
  try { git(dir, "merge", "--no-edit", "b"); } catch { mergeFailed = true; }
  const mid = observe(dir);
  record("merge-conflict-mid-scan", "MERGE_IN_PROGRESS", before, mid, {
    mergeExitedNonzero: mergeFailed,
    conflictMarkersInWorktree: fs.readFileSync(path.join(dir, "story.md"), "utf8").includes("<<<<<<<"),
  });
  fs.writeFileSync(path.join(dir, "story.md"), "# Story\n\nresolved version\n");
  git(dir, "add", "story.md");
  git(dir, "commit", "-q", "--no-edit");
  record("merge-conflict-resolved", "MUTATION", before, observe(dir));
}

// --- 9 + 10. worktrees: add, .git-file indirection, checkout inside linked worktree ---
{
  const { dir, shas } = makeRepo();
  git(dir, "branch", "wtb"); // at c3
  const wt = mktemp("vmark-g2-wt-");
  const wt2 = path.join(wt, "wt2");
  git(dir, "worktree", "add", "-q", wt2, "wtb");
  const wtBefore = observe(wt2);
  const mainObs = observe(dir);
  const independent =
    wtBefore.isGit && mainObs.isGit &&
    wtBefore.headRaw !== null && // HEAD readable through `gitdir:` file indirection
    fs.statSync(path.join(wt2, ".git")).isFile() &&
    wtBefore.gitDir !== mainObs.gitDir && // per-worktree gitdirs differ
    wtBefore.headRef !== mainObs.headRef; // wtb vs main
  rows.push({
    scenario: "worktree-add-independent-heads",
    expected: "INDEPENDENT",
    observed: independent ? "INDEPENDENT" : "NOT_INDEPENDENT",
    pass: independent,
    observables: {
      linkedDotGitIsFile: fs.statSync(path.join(wt2, ".git")).isFile(),
      linkedGitDir: wtBefore.gitDir,
      linkedHeadRaw: wtBefore.headRaw,
      primaryHeadRef: mainObs.headRef,
      linkedHeadRef: wtBefore.headRef,
    },
    note: "Switching between worktrees is workspace switching: each worktree has its own HEAD, " +
      "observed independently; no git operation occurs in either repo.",
  });
  git(wt2, "checkout", "-q", "--detach", shas[0]);
  record("worktree-checkout-inside-linked", "NAVIGATION", wtBefore, observe(wt2));
}

// --- 11. no-op scan (nothing happened between observations) ---
{
  const { dir } = makeRepo();
  record("no-op-rescan", "NO_OP", observe(dir), observe(dir));
}

// --- 12. no-git workspace ---
{
  const dir = mktemp("vmark-g2-nogit-");
  fs.writeFileSync(path.join(dir, "story.md"), "# Story\n\nplain workspace\n");
  const before = observe(dir);
  fs.writeFileSync(path.join(dir, "story.md"), "# Story\n\nedited externally\n");
  record("no-git-workspace", "NOT_GIT", before, observe(dir), {
    note: "Classifier reports NOT_GIT; all changes are ordinary external edits (scan reconciliation).",
  });
}

// --- results ---
const passCount = rows.filter((r) => r.pass).length;
const result = {
  probe: "g2-gitops",
  generatedAt: new Date().toISOString(),
  platform: `${process.platform} ${os.release()}`,
  git: git(os.tmpdir(), "--version"),
  watcherBlindSpot:
    "src-tauri/src/watcher.rs IGNORED_DIRS ignores `.git` — no .git/HEAD events reach VMark. " +
    "Every classification above was computed from before/after scan observations only " +
    "(HEAD content incl. worktree `gitdir:` indirection, resolved HEAD sha, rev-list --all HEAD set, " +
    "MERGE_HEAD/ORIG_HEAD presence, reflog tail), proving scan-time reconciliation suffices.",
  summary: { total: rows.length, pass: passCount, fail: rows.length - passCount },
  rows,
};
fs.writeFileSync(RESULTS_PATH, JSON.stringify(result, null, 2) + "\n");

for (const r of rows) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.scenario.padEnd(36)} expected=${r.expected.padEnd(18)} observed=${r.observed}`);
}
console.log(`\n${passCount}/${rows.length} rows correct. Results: ${RESULTS_PATH}`);

if (!KEEP) for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
process.exit(passCount === rows.length ? 0 : 1);
