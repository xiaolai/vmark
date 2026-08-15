#!/usr/bin/env node
/**
 * Generates `dev-docs/feature-ledger.md` — the per-feature evidence table.
 *
 * The spine (`scripts/feature-map.json`) names features and the paths they
 * occupy. EVERY other column here is JOINED from something this repo already
 * measures. Nothing in the output is typed by hand, and nothing is estimated.
 *
 * Sources joined:
 *   - tokei                                  -> code / comment lines (code only)
 *   - find + wc                              -> test files and test lines
 *   - coverage/coverage-summary.json         -> per-file line coverage (if present)
 *   - scripts/file-size-baseline.json        -> oversized-file debt
 *   - scripts/mock-boundaries-baseline.json  -> internal-module mocking
 *   - .dependency-cruiser-known-violations.json -> layering debt
 *   - scripts/plugin-store-coupling-baseline.json -> plugin->host coupling
 *   - git log                                -> commits in window, last touch
 *
 * THERE IS NO ISSUE-COUNT COLUMN, AND ADDING ONE WOULD BE A MISTAKE. It is the
 * obvious next column — "how much user pain has this feature caused?" — and it
 * was tried while this ledger was being built. Two things went wrong, and the
 * second is the one worth remembering.
 *
 * The mechanical error: closed issues were classified by keyword-matching their
 * TITLES, over the most recent 400 of the repository's 789, and the result was
 * then described as the whole history. A partial sample matched by a crude
 * regex is not a census, and the browser's two apparent hits turned out to be
 * accessibility audits of `LinkPopupView` that contained the word incidentally.
 *
 * The reasoning error, which no better query would fix: most of the features
 * worth asking about here are default-OFF. A feature nobody can reach without
 * flipping a flag produces no issue traffic BY CONSTRUCTION, so a low count
 * restates the gate column and reads as evidence about the feature. That is how
 * "the embedded browser has almost no issues" got offered as independent
 * corroboration that it is unused, when it is a near-tautology.
 *
 * If someone still wants demand data, it has to come from something that can
 * distinguish "nobody hit a bug" from "nobody could reach the code" — telemetry
 * on the flag, or issues filed by users who had it enabled. Until such a source
 * exists, the honest ledger is silent here rather than confidently wrong.
 *
 * THE HONESTY RULE, and it is the whole point of this script: a signal that was
 * not measured for a feature prints `--`, never `0`. Those are different claims.
 * `0` says "measured, and clean"; `--` says "nobody looked". Coverage is the one
 * that matters most — `coverage/` is gitignored, so on a fresh clone every
 * coverage cell is `--` until `pnpm test:coverage` runs. Printing `0%` there
 * would invent a catastrophe; printing `100%` would invent a guarantee.
 *
 * FAILS CLOSED on a stale spine: a `paths` entry matching nothing on disk, or a
 * `doc` naming a page that does not exist, is an error — not a warning. A ledger
 * that silently drops a renamed feature reports the same green as one that
 * works, which is the failure mode `check-scripts-parity` and `shell-slots`
 * already exist to prevent.
 *
 * Regenerate: `node scripts/gen-feature-ledger.mjs`. Do not hand-edit the output.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const WINDOW_DAYS = 180;
const args = process.argv.slice(2);
const SINCE = (args.find((a) => a.startsWith("--since=")) || "").split("=")[1] || `${WINDOW_DAYS} days ago`;

const sh = (cmd, a, opts = {}) => {
  try {
    return execFileSync(cmd, a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  } catch {
    return "";
  }
};
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const isTest = (f) => /\.test\.|\.spec\.|__tests__|\/test\/|\.bench\./.test(f);

// ---------------------------------------------------------------- spine
const spine = readJson(path.join(ROOT, "scripts/feature-map.json"));
if (!spine) {
  console.error("scripts/feature-map.json missing");
  process.exit(64);
}

const errors = [];
for (const f of spine.features) {
  for (const p of f.paths) {
    if (!existsSync(path.join(ROOT, p))) errors.push(`${f.name}: path does not exist -> ${p}`);
  }
  if (f.doc && !existsSync(path.join(ROOT, f.doc))) errors.push(`${f.name}: doc does not exist -> ${f.doc}`);
}
if (errors.length) {
  console.error("feature-map.json is stale — the ledger refuses to generate:\n");
  for (const e of errors) console.error("  " + e);
  console.error(`\n${errors.length} stale entr${errors.length === 1 ? "y" : "ies"}. Fix the map, do not delete the row.`);
  process.exit(65);
}

// ---------------------------------------------------------------- joins
const fileSize = readJson(path.join(ROOT, "scripts/file-size-baseline.json")) || {};
const mockB = readJson(path.join(ROOT, "scripts/mock-boundaries-baseline.json")) || {};
const depX = readJson(path.join(ROOT, ".dependency-cruiser-known-violations.json")) || {};
const coupling = readJson(path.join(ROOT, "scripts/plugin-store-coupling-baseline.json")) || {};
const covSummary = readJson(path.join(ROOT, "coverage/coverage-summary.json"));

// Each baseline nests its real payload one level down, under a key of its own
// choosing. Reading the top level instead yields an all-zero column that looks
// exactly like a clean feature — which is why these are asserted below.
const fileSizeFlat = { ...(fileSize.files || {}), ...(fileSize.testFiles || {}) };
const mockRecords = Array.isArray(mockB) ? mockB : mockB.entries || mockB.records || [];
const depRecords = Array.isArray(depX) ? depX : depX.modules || [];
const couplingUnits = coupling.units || {};

// A join that silently matches nothing is the defect this ledger is meant to
// expose in other people's code; refuse to emit one. Each baseline is known to
// be non-empty today, so an empty parse is a shape change, not a clean repo.
const joinAssertions = [
  ["file-size-baseline.json", Object.keys(fileSizeFlat).length],
  ["mock-boundaries-baseline.json", mockRecords.length],
  [".dependency-cruiser-known-violations.json", depRecords.length],
  ["plugin-store-coupling-baseline.json", Object.keys(couplingUnits).length],
];
const dead = joinAssertions.filter(([, count]) => count === 0);
if (dead.length) {
  console.error("A baseline parsed to zero records — its shape changed and this join is now blind:\n");
  for (const [name] of dead) console.error("  " + name);
  console.error("\nFix the parse. An all-zero column reads as 'clean', which is a false all-clear.");
  process.exit(66);
}

const underAny = (p, paths) => paths.some((base) => p === base || p.startsWith(base.endsWith("/") ? base : base + "/"));

// Code lines, tests excluded. ONLY executable languages count: `src/locales`
// holds ~26k lines of translation JSON, and counting that as "code" made
// Localization the largest feature in the repo and its test:code ratio 0.02 —
// a data corpus wearing a source-file costume. Data is measured, just not here.
const CODE_LANGS = new Set(["TypeScript", "Tsx", "JSX", "JavaScript", "Rust"]);
function tokeiCode(paths) {
  const out = sh("tokei", [...paths, "--output", "json", "--exclude", "*.test.*", "--exclude",
    "*.spec.*", "--exclude", "__tests__", "--exclude", "*.bench.*"]);
  if (!out) return null;
  try {
    const j = JSON.parse(out);
    let code = 0;
    for (const [lang, v] of Object.entries(j)) {
      if (lang === "Total" || !CODE_LANGS.has(lang)) continue;
      code += v.code || 0;
      for (const child of v.children ? Object.values(v.children).flat() : []) {
        code += child.stats?.code ?? 0;
      }
    }
    return code;
  } catch {
    return null;
  }
}

function listFiles(paths) {
  const out = sh("find", [...paths, "-type", "f", "(", "-name", "*.ts", "-o", "-name", "*.tsx",
    "-o", "-name", "*.rs", ")"]);
  return out.trim() ? out.trim().split("\n") : [];
}

const rows = [];
for (const f of spine.features) {
  const files = listFiles(f.paths);
  const testFiles = files.filter(isTest);
  const srcFiles = files.filter((x) => !isTest(x));
  const testLines = testFiles.reduce((n, x) => n + readFileSync(path.join(ROOT, x), "utf8").split("\n").length, 0);
  const code = tokeiCode(f.paths);

  // coverage: average of per-file line pct, weighted by statements
  let cov = null;
  if (covSummary) {
    let covered = 0, total = 0, seen = 0;
    for (const [abs, v] of Object.entries(covSummary)) {
      if (abs === "total") continue;
      const rel = abs.startsWith(ROOT) ? abs.slice(ROOT.length + 1) : abs;
      if (!underAny(rel, f.paths) || isTest(rel)) continue;
      covered += v.lines?.covered ?? 0;
      total += v.lines?.total ?? 0;
      seen++;
    }
    if (seen > 0 && total > 0) cov = (covered / total) * 100;
  }

  const bigFiles = Object.keys(fileSizeFlat).filter((k) => underAny(k, f.paths)).length;
  const mocks = mockRecords.filter((r) => r && r.file && underAny(r.file, f.paths)).length;
  const dep = depRecords.filter((r) => {
    const from = r.source || r.from || r.name;
    return from && underAny(from, f.paths);
  }).length;
  // Coupling units are bare plugin/module names ("codemirror", "toolbarActions"),
  // so match the LAST path segment rather than searching the whole string — a
  // substring test makes "svg" match "src/plugins/svgSomethingElse".
  const coup = Object.entries(couplingUnits)
    .filter(([unit]) => f.paths.some((p) => p.split("/").pop() === unit))
    .reduce((n, [, v]) =>
      n + (typeof v === "number" ? v : Object.values(v || {}).reduce((a, b) => a + (b || 0), 0)), 0);

  const commits = sh("git", ["log", `--since=${SINCE}`, "--oneline", "--", ...f.paths]).trim();
  const last = sh("git", ["log", "-1", "--format=%ad", "--date=short", "--", ...f.paths]).trim();

  rows.push({
    name: f.name,
    flag: f.flag,
    flagDefault: f.flagDefault,
    doc: f.doc,
    code,
    srcFiles: srcFiles.length,
    testFiles: testFiles.length,
    testLines,
    cov,
    bigFiles,
    mocks,
    dep,
    coup,
    commits: commits ? commits.split("\n").length : 0,
    last: last || "--",
  });
}

// ---------------------------------------------------------------- render
const n = (v) => (v === null || v === undefined ? "--" : String(v));
const pct = (v) => (v === null ? "--" : v.toFixed(1) + "%");
const ratio = (r) => (r.code && r.testLines ? (r.testLines / r.code).toFixed(2) : "--");
const flagCell = (r) => (r.flag ? `\`${r.flag}\`=${JSON.stringify(r.flagDefault)}` : "always on");

rows.sort((a, b) => (b.code || 0) - (a.code || 0));

const covPresent = covSummary !== null;
const doc = `# VMark feature ledger (generated)

Generated by \`node scripts/gen-feature-ledger.mjs\` from \`scripts/feature-map.json\`.
**Do not hand-edit.** Every number below is joined from something this repo
already measures; nothing here is estimated, scored, or graded.

- Churn window: commits since \`${SINCE}\`.
- \`--\` means **not measured**, which is not the same claim as \`0\`.
- Coverage source: ${covPresent
    ? "`coverage/coverage-summary.json` (gitignored — regenerate with `pnpm test:coverage`)"
    : "**absent.** Run `pnpm test:coverage`, then regenerate. All coverage cells read `--`."}

## Measured

| Feature | Code | Src files | Test files | Test:code | Line cov | Oversized | Mocks | Layering | Coupling | Commits | Last touch | Gate |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|---|
${rows.map((r) =>
  `| ${r.name} | ${n(r.code)} | ${r.srcFiles} | ${r.testFiles} | ${ratio(r)} | ${pct(r.cov)} | ${r.bigFiles || "0"} | ${r.mocks || "0"} | ${r.dep || "0"} | ${r.coup || "0"} | ${r.commits} | ${r.last} | ${flagCell(r)} |`
).join("\n")}

### Column provenance

| Column | Joined from | Unit |
|---|---|---|
| Code | \`tokei\`, tests excluded | lines of code (blanks/comments excluded) |
| Src / Test files | \`find\` over \`.ts/.tsx/.rs\` | file count |
| Test:code | test lines ÷ code lines | ratio, not a quality claim |
| Line cov | \`coverage/coverage-summary.json\` | covered ÷ total lines, per feature |
| Oversized | \`scripts/file-size-baseline.json\` | files frozen over the 300-line limit |
| Mocks | \`scripts/mock-boundaries-baseline.json\` | internal modules faked by this feature's tests |
| Layering | \`.dependency-cruiser-known-violations.json\` | frozen import-rule violations originating here |
| Coupling | \`scripts/plugin-store-coupling-baseline.json\` | plugin→host edges |
| Commits / Last touch | \`git log\` | count in window; ISO date |
| Gate | \`scripts/feature-map.json\` | setting key = shipped default |

## Undocumented features

Features with no \`website/guide\` page in the spine:

${rows.filter((r) => !r.doc).map((r) => `- ${r.name} (${n(r.code)} lines of code)`).join("\n") || "- none"}

## What this ledger deliberately does NOT contain

No score, grade, priority, target date, or owner. \`scripts/baseline-review-schedule.json\`
records what happened last time dates were invented for a file like this one and
stamped with somebody else's name. Judgement about what to strengthen belongs in
prose that cites these cells — written by a person, revisited when the numbers move.
`;

mkdirSync(path.join(ROOT, "dev-docs"), { recursive: true });
writeFileSync(path.join(ROOT, "dev-docs/feature-ledger.md"), doc);
console.log(`wrote dev-docs/feature-ledger.md — ${rows.length} features`);
if (!covPresent) console.log("NOTE: coverage/coverage-summary.json absent; coverage columns are '--'");
