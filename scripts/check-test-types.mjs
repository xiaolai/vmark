#!/usr/bin/env node
/**
 * Typecheck the TEST corpus, against a per-file baseline that ratchets DOWN.
 *
 * WHY. `tsconfig.json` excludes `*.test.ts(x)`, `__tests__/**`, `src/test/**`
 * and `src/bench/**`, so `pnpm typecheck` builds production source only.
 * Vitest transpiles without checking types. ESLint here is not type-aware.
 * The result was ~404k lines across ~1,537 files that NOTHING typechecked, and
 * the failure mode is silent: `sourceCjkActions.test.ts` built its settings
 * mock from three keys `CJKFormattingSettings` has never had
 * (`spaceBetweenCjkAndAlpha`, `spaceBetweenCjkAndDigit`, `fullWidthPunctuation`)
 * and passed for months, because a mock that does not match its subject still
 * satisfies a test written against the mock.
 *
 * WHY A BASELINE rather than zero. Measured on adoption: 2,503 errors in 429
 * files, all pre-existing. Fixing them is a real project and an unrelated one;
 * freezing them per file is the house pattern (`file-size`, `command-errors`,
 * `store-coupling`, `i18n`, `type-aware`) and it buys the thing that matters
 * immediately — a NEW or newly-broken test file is checked from day one.
 *
 * The baseline is per-file COUNTS, and it ratchets both ways:
 *   - a file with more errors than its entry fails,
 *   - a file with fewer fails too, until the win is recorded, so an
 *     improvement cannot silently become headroom for the next regression,
 *   - a baselined file that no longer errors at all must leave the baseline,
 *   - a file not in the baseline may have NO errors.
 *
 * A count, not an identity list, is a deliberate weakening here: two errors on
 * different lines of one file are not distinguishable without pinning line
 * numbers, and a baseline that churns on every edit above a frozen error is a
 * baseline people delete. The unit that matters — "this file is dirty, and by
 * how much" — is preserved.
 *
 * Usage:
 *   node scripts/check-test-types.mjs
 *   node scripts/check-test-types.mjs --update   # record wins / re-measure
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE_PATH = join(ROOT, "scripts/test-types-baseline.json");
export const PROJECT = "tsconfig.test.json";

/**
 * `path/to/file.ts(12,3): error TS2322: …` → `{ file, count }` per file.
 *
 * Only lines that START with a path are diagnostics; tsc indents the
 * continuation lines of a multi-line message, and counting those would inflate
 * every file with a long union mismatch.
 */
export function parseDiagnostics(stdout) {
  const counts = new Map();
  for (const line of stdout.split("\n")) {
    const match = /^([^\s(][^(]*)\(\d+,\d+\): error TS\d+:/.exec(line);
    if (!match) continue;
    const file = match[1].replace(/\\/g, "/");
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}

/** Human-readable failures. Pure: takes the measurement, not the filesystem. */
export function compare(counts, baseline) {
  const failures = [];
  const wins = [];

  for (const [file, count] of [...counts].sort()) {
    const allowed = baseline[file];
    if (allowed === undefined) {
      failures.push(
        `NEW: ${file} — ${count} type error(s). Test files are typechecked; fix them.`
      );
    } else if (count > allowed) {
      failures.push(`GREW: ${file} — ${allowed} → ${count} type error(s).`);
    } else if (count < allowed) {
      wins.push(`  "${file}": ${count},   (was ${allowed})`);
    }
  }

  for (const file of Object.keys(baseline).sort()) {
    if (!counts.has(file)) wins.push(`  remove "${file}" — now clean`);
  }

  return { failures, wins };
}

function measure() {
  try {
    execFileSync("npx", ["tsc", "-p", PROJECT, "--noEmit"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return new Map();
  } catch (error) {
    // tsc exits non-zero WITH diagnostics on stdout; that is the normal path.
    const stdout = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (stdout.trim() === "") {
      throw new Error(`tsc produced no output but failed: ${error.message}`);
    }
    return parseDiagnostics(stdout);
  }
}

function main() {
  const update = process.argv.includes("--update");

  if (!existsSync(BASELINE_PATH)) {
    console.error(`\n❌ Missing ${BASELINE_PATH}. Run with --update to create it.\n`);
    process.exit(1);
  }

  let counts;
  try {
    counts = measure();
  } catch (error) {
    // Fail closed: an unrunnable tsc is a finding, never a pass.
    console.error(`\n❌ Test typecheck could not run: ${error.message}\n`);
    process.exit(1);
  }

  if (update) {
    const next = Object.fromEntries([...counts].sort());
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    console.log(`✅ Baseline rewritten: ${counts.size} file(s), ${total} error(s).`);
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const { failures, wins } = compare(counts, baseline);

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} test-type finding(s):\n`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      `\nRun \`npx tsc -p ${PROJECT} --noEmit\` to see them.\n` +
        "The baseline ratchets DOWN only — never raise a number to pass.\n"
    );
    process.exit(1);
  }

  if (wins.length > 0) {
    console.error(`\n❌ ${wins.length} improvement(s) not recorded — lock them in:\n`);
    for (const w of wins) console.error(w);
    console.error(
      `\nRun \`node scripts/check-test-types.mjs --update\` so the win cannot\n` +
        "silently become headroom for the next regression.\n"
    );
    process.exit(1);
  }

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`✅ Test types held (${counts.size} baselined file(s), ${total} frozen error(s)).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
