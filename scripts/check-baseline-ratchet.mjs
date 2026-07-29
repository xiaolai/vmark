#!/usr/bin/env node
/**
 * Merge-base ratchet check for scripts/file-size-baseline.json (audit
 * 20260729 C3).
 *
 * `check-file-size.mjs` compares the tree against the baseline IN THE SAME
 * COMMIT — so a PR could raise `limit` (or an existing cap) together with the
 * offending file and pass every gate. This script closes that hole: it diffs
 * the current baseline against the one at the merge base with the target
 * branch and fails on any loosening:
 *   - `limit` increased
 *   - an existing file's cap increased
 * Cap reductions and entry removals are always allowed (ratchet-down). NEW
 * entries are allowed but listed loudly — they are visible in the PR diff and
 * require reviewer judgment (a fresh violation being baselined).
 *
 * Usage: node scripts/check-baseline-ratchet.mjs [base-ref]   (default origin/main)
 * Exits 0 when nothing loosened; skips (exit 0, notice) when the baseline
 * does not exist at the merge base.
 *
 * @coordinates-with .github/workflows/ci.yml — runs on pull_request before check:all
 * @coordinates-with scripts/check-file-size.mjs — the same-commit half of the gate
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateBaseline, BASELINE_PATH } from "./check-file-size.mjs";

// ─── Pure, testable core ───

/**
 * Compare two validated baselines. Returns the loosenings (failures) and the
 * new entries (allowed, reported for reviewer attention).
 */
export function compareBaselines(baseBaseline, headBaseline) {
  const failures = [];
  const newEntries = [];

  if (headBaseline.limit > baseBaseline.limit) {
    failures.push(
      `global limit raised: ${baseBaseline.limit} → ${headBaseline.limit} (never raise the limit)`
    );
  }
  if (headBaseline.testLimit > baseBaseline.testLimit) {
    failures.push(
      `test limit raised: ${baseBaseline.testLimit} → ${headBaseline.testLimit} (never raise the limit)`
    );
  }

  const sections = [
    ["files", baseBaseline.files, headBaseline.files],
    ["testFiles", baseBaseline.testFiles, headBaseline.testFiles],
  ];
  for (const [section, baseFiles, headFiles] of sections) {
    for (const [p, cap] of Object.entries(headFiles)) {
      const baseCap = baseFiles[p];
      if (baseCap === undefined) {
        newEntries.push({ p, cap, section });
      } else if (cap > baseCap) {
        failures.push(`${p}: ${section} cap raised ${baseCap} → ${cap} (never raise a cap)`);
      }
    }
  }

  return { failures, newEntries };
}

// ─── Git + reporting shell ───

function main() {
  const baseRef = process.argv[2] ?? "origin/main";

  let mergeBase;
  try {
    mergeBase = execFileSync("git", ["merge-base", baseRef, "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    console.error(`❌ Cannot resolve merge-base with ${baseRef} (need full fetch history).`);
    process.exit(1);
  }

  let baseRaw;
  try {
    baseRaw = execFileSync("git", ["show", `${mergeBase}:${BASELINE_PATH}`], {
      encoding: "utf8",
    });
  } catch {
    console.log(`ℹ️  ${BASELINE_PATH} absent at merge-base ${mergeBase.slice(0, 8)} — nothing to ratchet against.`);
    return;
  }

  const baseBaseline = validateBaseline(JSON.parse(baseRaw), `${BASELINE_PATH}@merge-base`);
  const headBaseline = validateBaseline(JSON.parse(readFileSync(BASELINE_PATH, "utf8")));

  const { failures, newEntries } = compareBaselines(baseBaseline, headBaseline);

  if (newEntries.length > 0) {
    console.log(`ℹ️  ${newEntries.length} NEW baseline entr${newEntries.length > 1 ? "ies" : "y"} (allowed, but a reviewer must judge the justification):`);
    for (const { p, cap } of newEntries) console.log(`  ${p} @ ${cap}`);
  }

  if (failures.length > 0) {
    console.error(`\n❌ Baseline loosened relative to merge-base ${mergeBase.slice(0, 8)}:`);
    for (const f of failures) console.error(`  ${f}`);
    console.error("  The baseline only ratchets DOWN. Split or shrink the file instead.");
    process.exit(1);
  }

  console.log(`✅ Baseline ratchet held against merge-base ${mergeBase.slice(0, 8)}.`);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
