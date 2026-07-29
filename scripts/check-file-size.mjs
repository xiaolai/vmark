#!/usr/bin/env node
/**
 * File-size regression gate (audit 20260612 deferred #2).
 *
 * The project rule is ~300 lines per code file (AGENTS.md). 153 files
 * already exceed it; burning them all down is a long campaign. This gate
 * freezes that set in scripts/file-size-baseline.json and fails CI when:
 *   - a file NOT in the baseline exceeds the limit (new violation), or
 *   - a baselined file grows beyond its recorded line count (regression), or
 *   - a baselined file no longer needs its entry (removed or shrunk to/below
 *     the limit) — ratchet-down hygiene is enforced, not just suggested, or
 *   - a baselined file shrank but its cap wasn't lowered (slack headroom).
 *
 * It can only ratchet down: split a file (or shrink it) and lower/remove
 * its baseline number. Raising a number is the one thing reviewers must
 * reject — and scripts/check-baseline-ratchet.mjs enforces exactly that
 * against the merge base in CI. Run via `pnpm lint:file-size`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Pure, testable core ───

// `server/mcp/src` was invisible to this gate until the 2026-07-28 MCP
// audit named it (§4); `server/content/src` had the same blind spot until
// the 2026-07-29 audit. Every workspace source tree must be listed.
export const ROOTS = ["src", "src-tauri/src", "server/mcp/src", "server/content/src"];
// .js/.mjs are code too — src/export/reader/vmark-reader.js bypassed the
// gate entirely while every .ts file ratcheted (audit 20260729).
export const EXTS = [".ts", ".tsx", ".rs", ".js", ".jsx", ".mjs"];
export const BASELINE_PATH = "scripts/file-size-baseline.json";
/** Separate, more generous cap for test/bench files (WI-7): suites grow
 * legitimately faster than production files, but 3,000-line suites are
 * maintainability debt too. Same ratchet-down semantics as the main gate. */
export const DEFAULT_TEST_LIMIT = 800;

/**
 * Files named types.ts that are exempt because they are DECLARATIONS ONLY.
 * A blanket `types.ts` exemption let runtime-bearing code hide behind the
 * name (audit 20260729 C1); every entry here is a reviewed claim that the
 * file contains no runtime logic. Adding one requires reading the file.
 */
export const TYPE_ONLY_ALLOWLIST = new Set([
  "src/lib/ghaWorkflow/types.ts", // 350 lines of interfaces/unions, zero runtime code
]);

/** Repo-relative path with POSIX separators — baseline keys and exclusion
 * patterns use `/`, which `join()` does not produce on Windows. */
export function toPosix(p) {
  return sep === "/" ? p : p.split(sep).join("/");
}

/** Test/bench/mock files — measured against the TEST limit, not excluded. */
export function isTestFile(p) {
  const base = p.split("/").pop() ?? "";
  if (base.includes(".test.") || base.includes(".bench.")) return true;
  if (p.includes("/__tests__/") || p.includes("/__mocks__/")) return true;
  return false;
}

export function isExcluded(p) {
  const base = p.split("/").pop() ?? "";
  if (base.endsWith(".d.ts")) return true;
  if (base === "types.ts" && TYPE_ONLY_ALLOWLIST.has(p)) return true;
  return false;
}

/** Line count matching the baseline's Python `sum(1 for _ in fh)`: number of
 * '\n', plus one more if the text does not end in a newline. */
export function countLines(text) {
  if (text.length === 0) return 0;
  let newlines = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) newlines++;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

/** Fail loudly on malformed baseline data — NaN comparisons pass silently. */
export function validateBaseline(raw, sourceLabel = BASELINE_PATH) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${sourceLabel}: expected a JSON object`);
  }
  const limit = raw.limit ?? 300;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`${sourceLabel}: "limit" must be a positive integer, got ${JSON.stringify(raw.limit)}`);
  }
  const files = raw.files ?? {};
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    throw new Error(`${sourceLabel}: "files" must be an object`);
  }
  for (const [p, cap] of Object.entries(files)) {
    if (!Number.isInteger(cap) || cap <= 0) {
      throw new Error(`${sourceLabel}: cap for ${p} must be a positive integer, got ${JSON.stringify(cap)}`);
    }
  }
  const testLimit = raw.testLimit ?? DEFAULT_TEST_LIMIT;
  if (!Number.isInteger(testLimit) || testLimit <= 0) {
    throw new Error(`${sourceLabel}: "testLimit" must be a positive integer, got ${JSON.stringify(raw.testLimit)}`);
  }
  const testFiles = raw.testFiles ?? {};
  if (typeof testFiles !== "object" || testFiles === null || Array.isArray(testFiles)) {
    throw new Error(`${sourceLabel}: "testFiles" must be an object`);
  }
  for (const [p, cap] of Object.entries(testFiles)) {
    if (!Number.isInteger(cap) || cap <= 0) {
      throw new Error(`${sourceLabel}: test cap for ${p} must be a positive integer, got ${JSON.stringify(cap)}`);
    }
  }
  return { limit, files, testLimit, testFiles };
}

/**
 * Compare measured sizes against the baseline.
 * `measured` is a Map of posix path → line count for every scanned file.
 */
export function evaluateSizes(measured, baseline) {
  const { limit, files: recorded } = baseline;
  const newViolations = [];
  const regressions = [];
  const slack = [];

  for (const [p, n] of measured) {
    const cap = recorded[p];
    if (cap === undefined) {
      if (n > limit) newViolations.push({ p, n });
    } else if (n > cap) {
      regressions.push({ p, n, cap });
    } else if (n < cap && n > limit) {
      // Shrunk but still above the limit: the cap must come down with it so
      // the win cannot silently regrow (ratchet-down, not freeze).
      slack.push({ p, n, cap });
    }
  }

  // Baseline entries whose file is gone or now at/below the limit: the entry
  // must be removed — a stale cap is regrowth headroom.
  const prunable = Object.keys(recorded).filter(
    (p) => !measured.has(p) || measured.get(p) <= limit
  );

  return { newViolations, regressions, slack, prunable };
}

// ─── Filesystem + reporting shell ───

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "target") continue;
      walk(p, out);
    } else if (EXTS.some((e) => entry.name.endsWith(e)) && !isExcluded(toPosix(p))) {
      out.push(toPosix(p));
    }
  }
}

function report(label, limit, result) {
  const { newViolations, regressions, slack, prunable } = result;
  let failed = false;

  if (newViolations.length > 0) {
    failed = true;
    console.error(`\n❌ ${newViolations.length} new ${label} file(s) exceed the ${limit}-line limit:`);
    for (const { p, n } of newViolations.sort((a, b) => b.n - a.n)) {
      console.error(`  ${n} lines  ${p}`);
    }
    console.error("  Split the file, or — only if truly unavoidable — add it to");
    console.error(`  ${BASELINE_PATH} with justification.`);
  }

  if (regressions.length > 0) {
    failed = true;
    console.error(`\n❌ ${regressions.length} baselined ${label} file(s) grew past their frozen size:`);
    for (const { p, n, cap } of regressions) {
      console.error(`  ${p}: ${cap} → ${n} lines (must not grow)`);
    }
    console.error("  Bring it back under its baseline; never raise the number.");
  }

  if (prunable.length > 0) {
    failed = true;
    console.error(`\n❌ ${prunable.length} stale ${label} baseline entr${prunable.length > 1 ? "ies" : "y"} (file removed or now under limit) — prune from ${BASELINE_PATH}:`);
    for (const p of prunable) console.error(`  ${p}`);
  }

  if (slack.length > 0) {
    failed = true;
    console.error(`\n❌ ${slack.length} baselined ${label} file(s) shrank — lower their caps to lock in the win:`);
    for (const { p, n, cap } of slack) {
      console.error(`  ${p}: cap ${cap} → set to ${n}`);
    }
  }

  return failed;
}

function main() {
  const baseline = validateBaseline(JSON.parse(readFileSync(BASELINE_PATH, "utf8")));

  const files = [];
  for (const root of ROOTS) {
    try {
      statSync(root);
    } catch {
      // A configured root that does not exist is a broken gate, not a
      // skippable inconvenience — scanning a partial tree reads as a pass.
      console.error(`❌ Configured scan root missing: ${root}`);
      process.exit(1);
    }
    walk(root, files);
  }

  const production = new Map();
  const tests = new Map();
  for (const p of files) {
    const n = countLines(readFileSync(p, "utf8"));
    (isTestFile(p) ? tests : production).set(p, n);
  }

  const prodResult = evaluateSizes(production, { limit: baseline.limit, files: baseline.files });
  const testResult = evaluateSizes(tests, { limit: baseline.testLimit, files: baseline.testFiles });

  const failed =
    report("production", baseline.limit, prodResult) |
    report("test", baseline.testLimit, testResult);

  if (failed) process.exit(1);
  console.log(
    `✅ File-size gate passed (${production.size} production + ${tests.size} test files scanned, ` +
      `${Object.keys(baseline.files).length}+${Object.keys(baseline.testFiles).length} baselined, none regressed).`,
  );
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
