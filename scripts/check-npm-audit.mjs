#!/usr/bin/env node
/**
 * Blocking npm advisory gate with a reviewed, ratcheting allowlist.
 *
 * Purpose: make a new dependency advisory fail CI, while letting the ones that
 * have been looked at and consciously accepted stay accepted — with the reason
 * written down next to them.
 *
 * Why it exists: the CI step was `continue-on-error: true` at
 * `--audit-level=critical`, so a vulnerable dependency could merge with the
 * advisory check visibly red (audit 20260906, C3). Its stated justification —
 * that pnpm 10's audit endpoint returns 410 — did not reproduce: the scan runs
 * fine and returns real findings. So the gate was disabled for a reason that
 * had stopped being true, which is the worst kind of disabled gate: one nobody
 * revisits because the comment explains itself.
 *
 * Two-way ratchet, the house standard:
 *   - an advisory at or above the threshold that is NOT in the baseline fails;
 *   - a baseline entry whose advisory is GONE fails, so acceptances cannot
 *     outlive the risk they were granted for;
 *   - a baseline entry with no `reason` fails, because an exception nobody
 *     justified is indistinguishable from one nobody noticed.
 *
 * An accepted advisory is a claim that the code is not reachable in the shipped
 * app, or that no fix exists — NOT that upgrading is inconvenient. Package
 * presence is not proof of a reachable exploit, and an advisory count is not a
 * reason to bump every dependency blindly.
 *
 * CI-tier, deliberately absent from `pnpm check:all`: it needs the network, and
 * a local checkout cannot guarantee one. Same reasoning as
 * `check-baseline-ratchet.mjs`. It runs inside the `fe-static` job, so the
 * required `frontend` check blocks on it.
 *
 * Usage:
 *   node scripts/check-npm-audit.mjs            # gate
 *   node scripts/check-npm-audit.mjs --report   # list findings, never fails
 *
 * @coordinates-with scripts/npm-audit-baseline.json — the reviewed allowlist
 * @coordinates-with .github/workflows/ci.yml — the fe-static step
 * @module scripts/check-npm-audit
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(REPO, "scripts/npm-audit-baseline.json");

/** Severities that fail when unlisted. `low` is reported, never blocking. */
export const BLOCKING_SEVERITIES = new Set(["moderate", "high", "critical"]);

/**
 * Normalize `pnpm audit --json` into a flat list.
 *
 * Exported so tests can drive the comparison without a network call — the
 * fetching and the deciding are separate on purpose.
 */
export function parseAdvisories(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Some pnpm versions emit NDJSON; merge the objects.
    parsed = {};
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        Object.assign(parsed, JSON.parse(line));
      } catch {
        /* a non-JSON progress line */
      }
    }
  }
  const advisories = parsed.advisories ?? {};
  return Object.values(advisories).map((a) => ({
    id: a.github_advisory_id || String(a.id),
    module: a.module_name,
    severity: a.severity,
    title: a.title,
    patched: a.patched_versions,
  }));
}

/**
 * Compare findings against the baseline.
 *
 * Returns `{ unlisted, stale, unjustified }` — every problem at once rather
 * than the first, so one run tells you the whole story.
 */
export function evaluate(findings, baseline) {
  const accepted = new Map(Object.entries(baseline.accepted ?? {}));
  const seen = new Set(findings.map((f) => f.id));

  const unlisted = findings.filter(
    (f) => BLOCKING_SEVERITIES.has(f.severity) && !accepted.has(f.id),
  );
  const stale = [...accepted.keys()].filter((id) => !seen.has(id));
  const unjustified = [...accepted.entries()]
    .filter(([, entry]) => !String(entry?.reason ?? "").trim())
    .map(([id]) => id);

  return { unlisted, stale, unjustified };
}

function main() {
  const report = process.argv.includes("--report");

  let raw;
  try {
    raw = execFileSync("pnpm", ["audit", "--json"], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // `pnpm audit` exits non-zero WHEN IT FINDS THINGS, which is the normal
    // case here — the findings are on stdout and the run succeeded.
    raw = error.stdout ?? "";
    if (!raw.trim()) {
      // No output at all means the scan itself failed. Fail closed: an
      // unavailable scanner must never read as "no vulnerabilities".
      console.error("npm-audit: the scan produced no output");
      console.error(String(error.stderr ?? error.message));
      process.exit(64);
    }
  }

  const findings = parseAdvisories(raw);
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const { unlisted, stale, unjustified } = evaluate(findings, baseline);

  const counts = findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `npm-audit: ${findings.length} advisories (${
      Object.entries(counts)
        .map(([s, n]) => `${n} ${s}`)
        .join(", ") || "none"
    })`,
  );

  if (report) {
    for (const f of findings) {
      const mark = baseline.accepted?.[f.id] ? "accepted" : "NEW";
      console.log(`  [${mark}] ${f.severity} ${f.module} ${f.id} — ${f.title}`);
    }
    return;
  }

  let failed = false;

  if (unlisted.length) {
    failed = true;
    console.error(`\n${unlisted.length} advisory/advisories are not reviewed:`);
    for (const f of unlisted) {
      console.error(`  ${f.severity} ${f.module} ${f.id} — ${f.title}`);
      console.error(`    patched: ${f.patched}`);
    }
    console.error(
      "\nFix the dependency, or add the id to scripts/npm-audit-baseline.json",
    );
    console.error("with a reason saying why it is not reachable in the shipped app.");
  }

  if (stale.length) {
    failed = true;
    console.error(`\n${stale.length} baseline entry/entries no longer apply:`);
    for (const id of stale) console.error(`  ${id}`);
    console.error("\nDelete them — an acceptance must not outlive its advisory.");
  }

  if (unjustified.length) {
    failed = true;
    console.error(`\n${unjustified.length} baseline entry/entries have no reason:`);
    for (const id of unjustified) console.error(`  ${id}`);
  }

  if (failed) process.exit(1);
  console.log("npm-audit: every advisory is reviewed and still current");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
