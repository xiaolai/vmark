#!/usr/bin/env node
/**
 * Type-aware lint ratchet — `pnpm lint:type-aware`, in `check:static`.
 *
 * Runs `eslint.typeaware.config.mjs` (the only config here that builds a
 * TypeScript `Program`) and compares the result against
 * `scripts/type-aware-baseline.json` per FILE and per RULE.
 *
 * WHY A RATCHET AND NOT ZERO. Measured when this gate was written: 152
 * violations across 6 rules, in a codebase where no type-aware rule has ever
 * run. Shipping it as zero-tolerance would mean either fixing 152 async
 * defects in the same change that installs the tool, or not installing the
 * tool. The repo's own idiom — file-size, command-errors, store-coupling —
 * is to freeze the measured set and ratchet it DOWN, and that is what this does.
 *
 * WHY PER-FILE-PER-RULE AND NOT A TOTAL. `.claude/rules/60-ai-governance.md` §11:
 * "Prefer identity baselines over counts wherever the checker can emit them: a
 * count permits a like-for-like swap." A single total would let a fixed
 * floating promise pay for a new one anywhere in the repo. Per-file-per-rule
 * narrows that to the same file AND the same rule. True identity (file+line)
 * was rejected because line numbers shift on every unrelated edit, which
 * produces baseline churn that trains people to regenerate without reading.
 *
 * TWO-WAY, like every other ratchet here: a new or grown entry fails, and so
 * does a file that IMPROVED — record the win with `--write-baseline`. Numbers
 * only go down.
 *
 * FAILS CLOSED: an eslint crash, unparseable JSON, or an empty result set is an
 * error, never a pass. An empty result is indistinguishable from "the config
 * matched no files", which is exactly how a gate silently stops working.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, "scripts/type-aware-baseline.json");
const CONFIG = "eslint.typeaware.config.mjs";
const WRITE = process.argv.includes("--write-baseline");

// The gate measures exactly the rules its config declares. See the comment on
// TYPE_AWARE_RULES: eslint reports `react-hooks/*` findings here too, at
// severity 2, which `pnpm lint` already owns.
const { TYPE_AWARE_RULES } = await import(pathToFileURL(path.join(ROOT, CONFIG)).href);
if (!Array.isArray(TYPE_AWARE_RULES) || TYPE_AWARE_RULES.length === 0) {
  console.error(`${CONFIG} does not export TYPE_AWARE_RULES — refusing to guess the gate's scope.`);
  process.exit(64);
}
const OWNED = new Set(TYPE_AWARE_RULES);

if (!existsSync(path.join(ROOT, CONFIG))) {
  console.error(`${CONFIG} not found — the type-aware gate cannot run.`);
  process.exit(64);
}

let raw;
try {
  raw = execFileSync(
    "node_modules/.bin/eslint",
    ["--config", CONFIG, "--no-config-lookup", "src", "--ext", ".ts,.tsx", "--format", "json"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, cwd: ROOT },
  );
} catch (e) {
  // eslint exits non-zero when it reports problems; that is the normal path.
  // stdout is still the JSON report. A genuinely broken run has no stdout.
  raw = e.stdout || "";
  if (!raw.trim()) {
    console.error("eslint produced no output — the type-aware run failed:\n");
    console.error((e.stderr || String(e)).slice(0, 4000));
    process.exit(64);
  }
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error("could not parse eslint JSON output — refusing to pass.");
  process.exit(64);
}
if (!Array.isArray(report) || report.length === 0) {
  console.error("eslint linted zero files — the config matched nothing. Refusing to pass vacuously.");
  process.exit(64);
}

/** file -> rule -> count */
const current = {};
for (const f of report) {
  const rel = path.relative(ROOT, f.filePath);
  for (const m of f.messages) {
    if (!m.ruleId || !OWNED.has(m.ruleId)) continue;
    const rule = m.ruleId.replace("@typescript-eslint/", "");
    current[rel] ??= {};
    current[rel][rule] = (current[rel][rule] || 0) + 1;
  }
}

const total = Object.values(current).reduce(
  (n, rules) => n + Object.values(rules).reduce((a, b) => a + b, 0), 0);

if (WRITE) {
  const sortedFiles = Object.keys(current).sort();
  const files = {};
  for (const f of sortedFiles) {
    files[f] = Object.fromEntries(Object.entries(current[f]).sort(([a], [b]) => a.localeCompare(b)));
  }
  writeFileSync(BASELINE, JSON.stringify({
    "//": [
      "Frozen type-aware lint violations, per file and per rule. Produced by",
      "`node scripts/check-type-aware.mjs --write-baseline`; the rules are chosen in",
      "eslint.typeaware.config.mjs and each one's violations are runtime defects,",
      "not style. Ratchets DOWN only, in both directions: a new or grown entry",
      "fails, and so does a file you have since fixed (record the win by",
      "rewriting this file). Never raise a number.",
      "",
      "THIS BASELINE IS EMPTY, AND THAT IS THE POINT. It opened at 152 findings",
      "on 2026-08-14 and was paid down to zero the same day; `files: {}` means",
      "the gate is effectively zero-tolerance now. A new entry here is a real",
      "regression, so fix the code rather than re-adding a line — the same rule",
      "`scripts/i18n-untranslated-baseline.json` carries for the same reason.",
      "",
      "no-floating-promises and no-misused-promises were 132 of the original 152.",
      "They are not cosmetic: in an app where every backend call is `invoke()`,",
      "an unawaited promise is a rejection nobody sees.",
    ],
    files,
  }, null, 2) + "\n");
  console.log(`wrote scripts/type-aware-baseline.json — ${Object.keys(files).length} files, ${total} violations`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("scripts/type-aware-baseline.json missing. Create it with --write-baseline.");
  process.exit(64);
}
const baseline = JSON.parse(readFileSync(BASELINE, "utf8")).files || {};

const grown = [];
const added = [];
const improved = [];

for (const [file, rules] of Object.entries(current)) {
  for (const [rule, count] of Object.entries(rules)) {
    const was = baseline[file]?.[rule];
    if (was === undefined) added.push(`${file} :: ${rule} (${count} new)`);
    else if (count > was) grown.push(`${file} :: ${rule} ${was} -> ${count}`);
  }
}
for (const [file, rules] of Object.entries(baseline)) {
  for (const [rule, was] of Object.entries(rules)) {
    const now = current[file]?.[rule] ?? 0;
    if (now < was) improved.push(`${file} :: ${rule} ${was} -> ${now}`);
  }
}

if (added.length || grown.length) {
  console.error(`Type-aware lint regressed — ${added.length + grown.length} finding(s):\n`);
  for (const a of added) console.error(`  NEW    ${a}`);
  for (const g of grown) console.error(`  GREW   ${g}`);
  console.error("\nThese are runtime defects, not style. Fix them; do not raise the baseline.");
  console.error("Inspect with: node_modules/.bin/eslint --config eslint.typeaware.config.mjs src");
  process.exit(1);
}

if (improved.length) {
  console.error(`Type-aware lint IMPROVED in ${improved.length} place(s) — record the win:\n`);
  for (const i of improved) console.error(`  FIXED  ${i}`);
  console.error("\nRun: node scripts/check-type-aware.mjs --write-baseline");
  process.exit(1);
}

console.log(`type-aware lint OK — ${total} violations, matching baseline (${Object.keys(baseline).length} files)`);
