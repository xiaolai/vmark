#!/usr/bin/env node
/**
 * Baseline review schedule — validator and overdue reporter (WI-AF3.2/3.3, F5).
 *
 * Two modes, deliberately separate because they answer different questions:
 *
 *   (default)  Is every committed baseline either DATED or justifiably EXEMPT,
 *              and does every key here still name a real baseline? Pure
 *              structure, no clock. Safe on the PR tier — it cannot change its
 *              mind overnight on an unchanged tree.
 *
 *   --report   Which deadlines have passed as of `--today`? Runs on a SCHEDULE
 *              and files a rolling issue. Deliberately not a PR gate: a
 *              calendar-triggered failure reddens an unrelated PR with nothing
 *              its author can do, and a gate like that gets switched off rather
 *              than obeyed.
 *
 * The dates themselves are ratcheted elsewhere — `scripts/baseline-review-schedule.json`
 * is registered in the manifest as `per-key-count`, so pushing a deadline out is
 * numerically a raise and fails against the merge base, with `allowRaise` as the
 * authorized, self-expiring exception. That is why this script never compares
 * against the base ref: the machinery that already does it is better than a
 * second copy.
 *
 * Usage:
 *   node scripts/check-review-schedule.mjs [--manifest=<path>] [--schedule=<path>]
 *   node scripts/check-review-schedule.mjs --report [--today=YYYYMMDD]
 *
 * Exit codes: 0 clean · 1 validation failure, or overdue entries in --report
 *
 * @coordinates-with scripts/baselineRatchetManifest.mjs
 * @coordinates-with scripts/baseline-review-schedule.json
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function flag(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const REPORT = process.argv.includes("--report");
const MANIFEST_PATH = flag("manifest", path.join(ROOT, "scripts/baselineRatchetManifest.mjs"));
const SCHEDULE_PATH = flag("schedule", path.join(ROOT, "scripts/baseline-review-schedule.json"));

const { MANIFEST } = await import(pathToFileURL(path.resolve(MANIFEST_PATH)).href);
const schedule = JSON.parse(readFileSync(path.resolve(SCHEDULE_PATH), "utf8"));

const reviews = schedule.reviews ?? {};
const targets = schedule.targets ?? {};
const exempt = schedule.exempt ?? {};
const failures = [];

/**
 * A real calendar date, not merely an 8-digit number. `20261301` and `20260231`
 * both sort perfectly well and are both nonsense; a schedule that accepts them
 * has a deadline nobody can act on.
 */
function invalidDate(n) {
  if (!Number.isInteger(n) || n < 19700101 || n > 21001231) return "not an 8-digit YYYYMMDD integer";
  const y = Math.floor(n / 10000);
  const m = Math.floor(n / 100) % 100;
  const d = n % 100;
  if (m < 1 || m > 12) return `month ${m} does not exist`;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} is not a real date`;
  }
  return null;
}

const registered = MANIFEST.entries.map((e) => e.path);
const registeredSet = new Set(registered);

// Every baseline is covered exactly once.
for (const p of registered) {
  const dated = Object.hasOwn(reviews, p);
  const isExempt = Object.hasOwn(exempt, p);
  if (dated && isExempt) {
    failures.push(`${p}: listed in BOTH reviews and exempt — it is either debt with a deadline, or not debt`);
  } else if (!dated && !isExempt) {
    failures.push(
      `${p}: has no review date and no exemption. Add a date + target to \`reviews\`/\`targets\`, ` +
        `or an \`exempt\` entry saying why it is not debt.`,
    );
  }
}

// Every key still names a real baseline (the other direction).
for (const key of [...Object.keys(reviews), ...Object.keys(exempt)]) {
  if (!registeredSet.has(key)) {
    failures.push(`${key}: named here but not registered in the ratchet manifest — stale entry`);
  }
}

// Claims must be justified, and deadlines must mean something.
for (const [p, reason] of Object.entries(exempt)) {
  if (typeof reason !== "string" || reason.trim().length < 10) {
    failures.push(`${p}: exemption needs a stated reason — "not debt" is a claim, not a fact`);
  }
}
for (const [p, when] of Object.entries(reviews)) {
  const bad = invalidDate(when);
  if (bad) failures.push(`${p}: review date ${when} is invalid — ${bad}`);
  const target = targets[p];
  if (typeof target !== "string" || target.trim().length < 4) {
    failures.push(`${p}: dated but has no target — "review it" without a goal is a reminder, not a plan`);
  }
}

if (failures.length > 0) {
  console.error("Baseline review schedule is inconsistent:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} problem(s). See ${path.relative(ROOT, SCHEDULE_PATH)}.`);
  process.exit(1);
}

if (!REPORT) {
  const dated = Object.keys(reviews).length;
  console.log(`✅ review schedule covers all ${registered.length} baselines (${dated} dated, ${Object.keys(exempt).length} exempt)`);
  process.exit(0);
}

// ---- report mode -----------------------------------------------------------
// The clock is INJECTED. A comparator that reads the wall clock cannot be
// tested at a boundary, and "is it overdue" has exactly one interesting
// boundary: the due day itself.
const todayFlag = flag("today");
const today = todayFlag
  ? Number(todayFlag)
  : Number(new Date().toISOString().slice(0, 10).replaceAll("-", ""));
if (invalidDate(today)) {
  console.error(`--today=${todayFlag} is not a valid YYYYMMDD date`);
  process.exit(1);
}

// Strictly greater: the due day is the day it is due, not the day it is late.
const overdue = Object.entries(reviews)
  .filter(([, when]) => today > when)
  .sort((a, b) => a[1] - b[1]);

if (overdue.length === 0) {
  console.log(`✅ no baseline review is overdue as of ${today}`);
  process.exit(0);
}

const owner = schedule.owners?.default ?? "unassigned";
console.log(`## ${overdue.length} baseline review(s) overdue as of ${today}\n`);
console.log("| Baseline | Due | Owner | Target |");
console.log("|---|---|---|---|");
for (const [p, when] of overdue) {
  console.log(`| \`${p}\` | ${when} | ${owner} | ${targets[p]} |`);
}
console.log(
  "\nEither pay some of it down and pull the date in, or move the date out with an" +
    "\n`allowRaise` entry in `scripts/baselineRatchetManifest.mjs` stating why." +
    "\nMoving it silently is what the merge-base ratchet refuses.",
);
process.exit(1);
