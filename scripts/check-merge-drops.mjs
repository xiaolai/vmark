#!/usr/bin/env node
/**
 * Detect a merge resolution that silently DISCARDED one side's change.
 *
 * Git shows a conflict only where hunks overlap. When one side edits line 160
 * and the other MOVES lines 220-290 into a new file, resolving with `--ours`
 * or `--theirs` throws the other edit away and the merge is green — no
 * conflict marker, no failing test, nothing to review. Both directions of that
 * happened in the origin/main merge on this branch:
 *
 *   - `fileOpen.ts` taken from our side would have reverted main's WI-12.2
 *     ownership-aware activate, which lived inside the switch we had moved out.
 *   - Rebuilding it from main's side then dropped OUR WI-1.5 ingest routing.
 *
 * The check is a four-way comparison per file: base, ours, theirs, merged. If
 * the merged content is byte-identical to one side while the OTHER side had
 * also changed that file, that side's change is gone.
 *
 * A hit is not automatically a bug. Taking one side wholesale is correct when
 * the other side's change was RELOCATED — re-applied in a file the other side
 * moved the code to. That is why this reports and asks rather than failing
 * blind: an acknowledged drop goes in `scripts/merge-drop-allowlist.json` with
 * the file it moved to, so the claim is written down and checkable.
 *
 * Usage:
 *   node scripts/check-merge-drops.mjs            # in-progress merge, else HEAD
 *   node scripts/check-merge-drops.mjs <commit>   # a specific merge commit
 *
 * With a merge IN PROGRESS (MERGE_HEAD present) it compares the WORKING TREE,
 * so a discarded side is caught before the merge commit exists — which is the
 * only moment the fix is still cheap.
 *
 * Exit 0 when every drop is accounted for; 1 when one is not.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ALLOWLIST = "scripts/merge-drop-allowlist.json";

/** `git` with arguments, trimmed stdout, empty string on non-zero exit. */
function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return "";
  }
}

/** File content at a revision, or null when the file does not exist there. */
function blob(rev, path) {
  try {
    return execFileSync("git", ["show", `${rev}:${path}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

const gitDir = git("rev-parse", "--git-dir").trim();
const mergeHeadPath = gitDir ? join(gitDir, "MERGE_HEAD") : "";
const inProgress = !process.argv[2] && mergeHeadPath && existsSync(mergeHeadPath);

let merged, ours, theirs;
if (inProgress) {
  // Merged content is the WORKING TREE, read from disk rather than a rev.
  merged = null;
  ours = git("rev-parse", "HEAD").trim();
  theirs = readFileSync(mergeHeadPath, "utf8").trim().split("\n")[0];
} else {
  const mergeRef = process.argv[2] ?? "HEAD";
  const parents = git("rev-list", "--parents", "-n", "1", mergeRef).trim().split(/\s+/);
  if (parents.length < 3) {
    console.log(`✅ ${mergeRef} is not a merge commit and no merge is in progress — nothing to check.`);
    process.exit(0);
  }
  [merged, ours, theirs] = parents;
}
const base = git("merge-base", ours, theirs).trim();
if (!base) {
  console.error(`❌ No merge base between ${ours} and ${theirs}.`);
  process.exit(1);
}

/** Files each side changed since the base, as sets. */
const changed = (rev) =>
  new Set(
    git("diff", "--name-only", `${base}..${rev}`)
      .split("\n")
      .filter(Boolean)
      .filter((p) => /\.(ts|tsx|rs|json|mjs|css)$/.test(p))
  );

const oursChanged = changed(ours);
const theirsChanged = changed(theirs);
const bothTouched = [...oursChanged].filter((p) => theirsChanged.has(p)).sort();

const allow = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, "utf8")) : {};
const drops = [];

for (const path of bothTouched) {
  const [b, o, t] = [base, ours, theirs].map((rev) => blob(rev, path));
  // In-progress: the resolution lives in the working tree, not in any rev.
  const m = merged === null
    ? (existsSync(path) ? readFileSync(path, "utf8") : null)
    : blob(merged, path);
  // A file deleted on a side is a resolution question of its own, not a
  // silent drop — `git` always conflicts on modify/delete.
  if (b === null || o === null || t === null || m === null) continue;

  if (m === t && o !== b) drops.push({ path, lost: "ours", kept: "theirs" });
  else if (m === o && t !== b) drops.push({ path, lost: "theirs", kept: "ours" });
}

if (drops.length === 0) {
  console.log(
    `✅ Merge-drop check passed (${bothTouched.length} file(s) changed on both sides, none resolved by discarding a side).`
  );
  process.exit(0);
}

const unacknowledged = drops.filter((d) => !allow[d.path]);

const label = merged === null ? "In-progress merge" : `Merge ${merged.slice(0, 8)}`;
console.log(`${label}: ${drops.length} file(s) resolved by taking one side whole.\n`);
for (const d of drops) {
  const note = allow[d.path];
  const mark = note ? "✔" : "✗";
  console.log(`  ${mark} ${d.path}`);
  console.log(`      kept ${d.kept}; ${d.lost === "ours" ? "OUR" : "THEIR"} change to this file is not in the result`);
  if (note) console.log(`      acknowledged: ${note}`);
}

if (unacknowledged.length > 0) {
  console.error(
    `\n❌ ${unacknowledged.length} unacknowledged drop(s).\n` +
      `   If the change was RELOCATED, say where in ${ALLOWLIST}:\n` +
      `     { "${unacknowledged[0].path}": "re-applied in path/to/new/home.ts" }\n` +
      `   If it was not, the change is gone — restore it.`
  );
  process.exit(1);
}

console.log(`\n✅ All ${drops.length} drop(s) acknowledged as relocations.`);
process.exit(0);
