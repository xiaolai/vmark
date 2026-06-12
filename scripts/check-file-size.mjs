#!/usr/bin/env node
/**
 * File-size regression gate (audit 20260612 deferred #2).
 *
 * The project rule is ~300 lines per code file (AGENTS.md). 153 files
 * already exceed it; burning them all down is a long campaign. This gate
 * freezes that set in scripts/file-size-baseline.json and fails CI when:
 *   - a file NOT in the baseline exceeds the limit (new violation), or
 *   - a baselined file grows beyond its recorded line count (regression).
 *
 * It can only ratchet down: split a file (or shrink it) and lower/remove
 * its baseline number. Raising a number is the one thing reviewers must
 * reject. Run via `pnpm lint:file-size` (wired into check:all).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "src-tauri/src"];
const EXTS = [".ts", ".tsx", ".rs"];
const BASELINE_PATH = "scripts/file-size-baseline.json";

function isExcluded(p) {
  const base = p.split("/").pop() ?? "";
  if (base.includes(".test.") || base.includes(".bench.")) return true;
  if (p.includes("/__tests__/") || p.includes("/__mocks__/")) return true;
  if (base.endsWith(".d.ts")) return true;
  if (base === "types.ts") return true;
  return false;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "target") continue;
      walk(p, out);
    } else if (EXTS.some((e) => entry.name.endsWith(e)) && !isExcluded(p)) {
      out.push(p);
    }
  }
}

function lineCount(p) {
  const text = readFileSync(p, "utf8");
  if (text.length === 0) return 0;
  // Match the baseline's Python `sum(1 for _ in fh)`: number of '\n', plus
  // one more if the file does not end in a newline (trailing partial line).
  let newlines = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) newlines++;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const LIMIT = baseline.limit ?? 300;
const recorded = baseline.files ?? {};

const files = [];
for (const root of ROOTS) {
  try {
    statSync(root);
  } catch {
    continue;
  }
  walk(root, files);
}

const newViolations = [];
const regressions = [];
const seen = new Set();

for (const p of files) {
  const n = lineCount(p);
  seen.add(p);
  const cap = recorded[p];
  if (cap === undefined) {
    if (n > LIMIT) newViolations.push({ p, n });
  } else if (n > cap) {
    regressions.push({ p, n, cap });
  }
}

// Files in the baseline that no longer exist or dropped under the limit:
// note them so reviewers prune the baseline (ratchet-down hygiene).
const prunable = Object.keys(recorded).filter((p) => !seen.has(p));

let failed = false;

if (newViolations.length > 0) {
  failed = true;
  console.error(`\n❌ ${newViolations.length} new file(s) exceed the ${LIMIT}-line limit:`);
  for (const { p, n } of newViolations.sort((a, b) => b.n - a.n)) {
    console.error(`  ${n} lines  ${p}`);
  }
  console.error("  Split the file, or — only if truly unavoidable — add it to");
  console.error(`  ${BASELINE_PATH} with justification.`);
}

if (regressions.length > 0) {
  failed = true;
  console.error(`\n❌ ${regressions.length} baselined file(s) grew past their frozen size:`);
  for (const { p, n, cap } of regressions) {
    console.error(`  ${p}: ${cap} → ${n} lines (must not grow)`);
  }
  console.error("  Bring it back under its baseline; never raise the number.");
}

if (prunable.length > 0) {
  console.warn(`\n⚠️  ${prunable.length} baseline entr${prunable.length > 1 ? "ies are" : "y is"} stale (file removed or now under limit) — prune from ${BASELINE_PATH}:`);
  for (const p of prunable) console.warn(`  ${p}`);
}

if (failed) process.exit(1);
console.log(
  `✅ File-size gate passed (${seen.size} files scanned, ${Object.keys(recorded).length} baselined, none regressed).`,
);
