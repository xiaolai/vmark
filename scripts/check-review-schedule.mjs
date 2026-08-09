#!/usr/bin/env node
/**
 * Baseline debt register — validator and staleness reporter (WI-AF3.2/3.3, F5).
 *
 * Two modes, deliberately separate because they answer different questions:
 *
 *   (default)  Is every committed baseline either TRACKED as debt or
 *              justifiably EXEMPT, and does every key here still name a real
 *              baseline? Pure structure, no clock, no network. Safe on the PR
 *              tier — it cannot change its mind overnight on an unchanged tree.
 *
 *   --report   How big is each tracked baseline, and how long has it gone
 *              unchanged? Runs on a schedule and keeps one rolling issue up to
 *              date.
 *
 * THERE ARE NO DEADLINES, AND THAT IS THE POINT. An earlier revision of this
 * script policed a review date per baseline. The dates had been invented by the
 * agent that wrote them — a fortnightly stagger starting seven weeks out — and
 * recorded under `owner: maintainer`, which turns a guess into someone else's
 * commitment. Exactly one tracked baseline has enough history to extrapolate a
 * rate from (file-size: 153 -> 92 over two months); mock-boundaries has a single
 * commit, its own creation. Policing a fabricated number does not make it true,
 * it just makes it load-bearing.
 *
 * Staleness IS measurable, needs no one's permission, and answers the question
 * the deadline was a proxy for: is this debt moving? Debt that stops moving
 * shows up on its own.
 *
 * Usage:
 *   node scripts/check-review-schedule.mjs [--manifest=<path>] [--schedule=<path>]
 *   node scripts/check-review-schedule.mjs --report [--today=YYYY-MM-DD]
 *
 * Exit codes: 0 clean · 1 validation failure (report mode is informational and
 * exits 0 unless it cannot measure).
 *
 * @coordinates-with scripts/baseline-review-schedule.json
 * @coordinates-with scripts/baselineRatchetManifest.mjs — the entries this covers
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
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

const tracked = schedule.tracked ?? {};
const exempt = schedule.exempt ?? {};
const failures = [];

const registered = MANIFEST.entries.map((e) => e.path);
const registeredSet = new Set(registered);

// Every baseline is covered exactly once.
for (const p of registered) {
  const isTracked = Object.hasOwn(tracked, p);
  const isExempt = Object.hasOwn(exempt, p);
  if (isTracked && isExempt) {
    failures.push(`${p}: listed in BOTH tracked and exempt — it is either debt, or it is not`);
  } else if (!isTracked && !isExempt) {
    failures.push(
      `${p}: is neither tracked as debt nor exempt. Add it to \`tracked\` with what paying ` +
        `it down means, or to \`exempt\` with why it is not debt.`,
    );
  }
}

// Every key still names a real baseline (the other direction).
for (const key of [...Object.keys(tracked), ...Object.keys(exempt)]) {
  if (!registeredSet.has(key)) {
    failures.push(`${key}: named here but not registered in the ratchet manifest — stale entry`);
  }
}

// Claims must be justified, and a target must say something.
for (const [p, reason] of Object.entries(exempt)) {
  if (typeof reason !== "string" || reason.trim().length < 10) {
    failures.push(`${p}: exemption needs a stated reason — "not debt" is a claim, not a fact`);
  }
}
for (const [p, target] of Object.entries(tracked)) {
  if (typeof target !== "string" || target.trim().length < 4) {
    failures.push(`${p}: tracked but has no target — debt with no notion of "paid" never is`);
  }
}

if (failures.length > 0) {
  console.error("Baseline debt register is inconsistent:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} problem(s). See ${path.relative(ROOT, SCHEDULE_PATH)}.`);
  process.exit(1);
}

if (!REPORT) {
  console.log(
    `✅ debt register covers all ${registered.length} baselines ` +
      `(${Object.keys(tracked).length} tracked, ${Object.keys(exempt).length} exempt)`,
  );
  process.exit(0);
}

// ---- report mode -----------------------------------------------------------

/** Read a dotted path out of a document; "" is the document itself. */
function getAt(doc, at) {
  if (!at) return doc;
  return at.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), doc);
}

/**
 * How many entries does this baseline hold right now? Derived from the
 * manifest's OWN checks, so it counts the things the ratchet counts.
 *
 * ENTRIES, not a summed magnitude. A first cut summed per-key VALUES, which is
 * right for command-error (99 legacy signatures) and nonsense for file-size,
 * whose values are line counts — it reported 124,778 units of "debt" for 92
 * oversized files. There is no single definition of size across these
 * baselines, so this reports the one thing that means the same everywhere: how
 * many records the baseline is carrying. The `target` column says what paying
 * it down means; that is where the per-baseline meaning lives.
 *
 * Scalar-only baselines (bespoke-buttons) are the exception: their scalar IS
 * the quantity, so it is reported directly rather than as "no entries".
 * Custom comparators return null — their identities are computed by
 * comparator-specific code, and guessing a count would be inventing a number
 * again, which is the whole reason this file no longer has dates in it.
 */
function measure(entryPath) {
  const entry = MANIFEST.entries.find((e) => e.path === entryPath);
  const abs = path.join(ROOT, entryPath);
  if (!entry || !existsSync(abs) || entry.format === "text") return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
  // Comment keys are documentation, not debt. `merge-drop-allowlist.json`
  // reported 3 entries for 2 real ones because `_comment` was counted, and a
  // register that miscounts the debt it exists to describe is the same class of
  // defect as the invented dates it replaced.
  const isComment = (k) => k.startsWith("//") || k.startsWith("_comment");
  const countKeys = (v) =>
    Array.isArray(v) ? v.length : Object.keys(v).filter((k) => !isComment(k)).length;
  let entries = 0;
  let scalars = 0;
  let sawRecords = false;
  let sawScalar = false;
  for (const check of entry.checks) {
    const value = getAt(doc, check.at);
    if (value == null) continue;
    if (check.mode === "identity" && typeof value === "object") {
      entries += countKeys(value);
      sawRecords = true;
    } else if (check.mode === "per-key-count" && typeof value === "object") {
      entries += countKeys(value);
      sawRecords = true;
    } else if (check.mode === "scalar" && typeof value === "number") {
      scalars += value;
      sawScalar = true;
    }
  }
  if (sawRecords) return entries;
  return sawScalar ? scalars : null;
}

/** Days since the file last changed in git, or null when it cannot be read. */
function daysSinceChange(entryPath, now) {
  const out = spawnSync("git", ["log", "-1", "--format=%ct", "--", entryPath], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (out.status !== 0) return null;
  const ts = Number(out.stdout.trim());
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return (now - ts * 1000) / 86_400_000;
}

const todayFlag = flag("today");
const now = todayFlag ? Date.parse(`${todayFlag}T00:00:00Z`) : Date.now();
if (Number.isNaN(now)) {
  console.error(`--today=${todayFlag} is not a date`);
  process.exit(1);
}

const rows = Object.keys(tracked)
  .map((p) => ({ path: p, size: measure(p), stale: daysSinceChange(p, now), target: tracked[p] }))
  .sort((a, b) => (b.stale ?? -1) - (a.stale ?? -1));

console.log(`## Baseline debt — ${rows.length} tracked\n`);
console.log("Stalest first. No deadlines: these are measurements, not commitments.\n");
console.log("| Baseline | Entries | Unchanged for | Target |");
console.log("|---|---:|---:|---|");
for (const r of rows) {
  const size = r.size == null ? "—" : String(r.size);
  const stale = r.stale == null ? "unknown" : `${Math.floor(r.stale)}d`;
  console.log(`| \`${r.path}\` | ${size} | ${stale} | ${r.target} |`);
}
console.log(
  "\nA row that never moves is the finding. `Entries` counts the records the ratchet" +
    "\nitself compares — not a summed magnitude, because the values mean different" +
    "\nthings per baseline (file-size holds line counts, command-error holds signature" +
    "\ncounts). `—` means a custom comparator owns the shape and no honest total exists.",
);
process.exit(0);
