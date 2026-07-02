#!/usr/bin/env node
/**
 * Bench regression comparator.
 *
 * Purpose: turn two `vitest bench --outputJson` payloads (a baseline ref and
 * the current tree) into a regression verdict, so the CI bench job is a real
 * signal instead of an execute-without-error smoke.
 *
 * Comparison semantics:
 *   - Benchmarks are keyed by "<group fullName> :: <bench name>".
 *   - A regression is `current mean > ratioThreshold * baseline mean`.
 *     The default threshold (2.5x) is deliberately generous: shared CI
 *     runners are noisy, and a gate that cries wolf gets deleted.
 *   - Baselines faster than `minBaselineMeanMs` (default 1 ms) are skipped:
 *     micro-benchmarks amplify scheduler noise into meaningless ratios.
 *   - Added/removed benchmarks are reported but never fail the run —
 *     renames and suite growth are normal.
 *
 * Usage:
 *   node scripts/compare-bench.mjs <baseline.json> <current.json> [--threshold 2.5]
 *
 * Exit codes: 0 = no regressions; 1 = at least one regression; 2 = bad input.
 * When GITHUB_STEP_SUMMARY is set, a markdown table is appended there too.
 */

import { readFileSync, appendFileSync } from "node:fs";

/** Flatten a vitest bench JSON payload into { "<group> :: <name>": mean }. */
export function flattenBenchmarks(payload) {
  const flat = {};
  for (const file of payload?.files ?? []) {
    for (const group of file?.groups ?? []) {
      for (const bench of group?.benchmarks ?? []) {
        // Number.isFinite rejects NaN/±Infinity — a malformed mean must not
        // silently pass as "compared, no regression".
        if (Number.isFinite(bench?.mean) && bench.name) {
          flat[`${group.fullName} :: ${bench.name}`] = bench.mean;
        }
      }
    }
  }
  return flat;
}

/**
 * Compare two bench payloads.
 * Returns { ok, regressions, added, removed, skippedBelowFloor, compared }.
 */
export function compareBenchResults(baseline, current, options = {}) {
  const { ratioThreshold = 2.5, minBaselineMeanMs = 1 } = options;
  const base = flattenBenchmarks(baseline);
  const cur = flattenBenchmarks(current);

  const regressions = [];
  const skippedBelowFloor = [];
  const compared = [];
  const removed = Object.keys(base).filter((k) => !(k in cur));
  const added = Object.keys(cur).filter((k) => !(k in base));

  for (const [name, baselineMean] of Object.entries(base)) {
    if (!(name in cur)) continue;
    if (baselineMean < minBaselineMeanMs) {
      skippedBelowFloor.push(name);
      continue;
    }
    const currentMean = cur[name];
    const ratio = currentMean / baselineMean;
    compared.push({ name, baselineMean, currentMean, ratio });
    if (ratio > ratioThreshold) {
      regressions.push({ name, baselineMean, currentMean, ratio });
    }
  }

  return {
    ok: regressions.length === 0,
    regressions,
    added,
    removed,
    skippedBelowFloor,
    compared,
  };
}

function formatMs(ms) {
  return ms >= 100 ? ms.toFixed(0) : ms.toFixed(2);
}

/** Escape a value for a markdown table cell (pipes break columns, newlines break rows). */
function mdCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderMarkdown(result, ratioThreshold) {
  const lines = [
    "## Bench comparison",
    "",
    `Threshold: current mean > ${ratioThreshold}x baseline mean fails.`,
    "",
    "| Benchmark | Baseline (ms) | Current (ms) | Ratio | Verdict |",
    "|---|---:|---:|---:|---|",
  ];
  for (const row of result.compared) {
    const verdict = row.ratio > ratioThreshold ? "REGRESSION" : "ok";
    lines.push(
      `| ${mdCell(row.name)} | ${formatMs(row.baselineMean)} | ${formatMs(row.currentMean)} | ${row.ratio.toFixed(2)}x | ${verdict} |`,
    );
  }
  if (result.skippedBelowFloor.length) {
    lines.push("", `Skipped (baseline < 1 ms, noise floor): ${result.skippedBelowFloor.join(", ")}`);
  }
  if (result.added.length) lines.push("", `Added: ${result.added.join(", ")}`);
  if (result.removed.length) lines.push("", `Removed: ${result.removed.join(", ")}`);
  return lines.join("\n");
}

/**
 * Parse CLI args positionally, CONSUMING flag values — the documented
 * `--threshold 2.5` must not have its value miscounted as a third file.
 * Returns { files, ratioThreshold } or { error } for bad input.
 */
export function parseCliArgs(args) {
  const files = [];
  let ratioThreshold = 2.5;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--threshold") {
      ratioThreshold = Number(args[++i]);
    } else if (a.startsWith("--")) {
      return { error: `unknown flag "${a}"` };
    } else {
      files.push(a);
    }
  }
  if (files.length !== 2) {
    return { error: `expected exactly 2 input files, got ${files.length}` };
  }
  if (!Number.isFinite(ratioThreshold) || ratioThreshold <= 0) {
    return { error: "--threshold must be a positive number" };
  }
  return { files, ratioThreshold };
}

function main() {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(`Invalid arguments: ${parsed.error}`);
    console.error(
      "Usage: node scripts/compare-bench.mjs <baseline.json> <current.json> [--threshold 2.5]",
    );
    process.exit(2);
  }
  const { files, ratioThreshold } = parsed;

  let baseline, current;
  try {
    baseline = JSON.parse(readFileSync(files[0], "utf8"));
    current = JSON.parse(readFileSync(files[1], "utf8"));
  } catch (err) {
    console.error(`Failed to read bench JSON: ${err?.message ?? err}`);
    process.exit(2);
  }

  const result = compareBenchResults(baseline, current, { ratioThreshold });
  const markdown = renderMarkdown(result, ratioThreshold);
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }

  if (!result.ok) {
    console.error(
      `\n${result.regressions.length} bench regression(s) past ${ratioThreshold}x.`,
    );
    process.exit(1);
  }
  console.error("\nNo bench regressions.");
}

// Only run the CLI when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
