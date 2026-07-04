#!/usr/bin/env node
/**
 * Barrel-purity gate for `index.ts` files.
 *
 * vitest.config.ts excludes `**\/index.ts` from coverage on the invariant
 * that every index.ts is a pure re-export barrel (imports, re-exports,
 * comments — no runtime logic). If logic creeps into an index.ts it would
 * silently escape the coverage ratchet. This script enforces the
 * invariant: it fails when any `src/**\/index.ts` contains statements
 * other than imports and re-exports.
 *
 * Allowed in a barrel:
 *   - `import ...` (needed for `export { x }` re-export style)
 *   - `export { ... } from "..."` / `export * from "..."`
 *   - `export type { ... }` / `export { ... }` (re-export of imports)
 *   - `export type X = ...` / `export interface X {}` (type-only, erased
 *     at runtime — nothing to cover)
 *   - comments and blank lines
 *
 * Anything else (function/class/const declarations with initializers,
 * side-effect statements, control flow) is logic: move it to a named
 * module (e.g. `client.ts`) and re-export it from the barrel.
 *
 * Run via `pnpm lint:barrels` (wired into check:all).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";

/** Collect all index.ts files under src/. */
function findIndexFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      findIndexFiles(p, out);
    } else if (entry.name === "index.ts") {
      out.push(p);
    }
  }
  return out;
}

/** Strip // and /* *\/ comments AND string contents. Only the quote
 *  characters survive from strings — the classifier never needs specifier
 *  text, and brackets inside a specifier (`from "./odd({dir"`) must not
 *  skew the depth tracking that separates statements from continuations. */
function stripComments(source) {
  let out = "";
  let i = 0;
  let mode = "code"; // code | line | block | single | double | template
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") {
        mode = "line";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        mode = "block";
        i += 2;
        continue;
      }
      if (c === "'") mode = "single";
      else if (c === '"') mode = "double";
      else if (c === "`") mode = "template";
      out += c;
    } else if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += c;
      }
    } else if (mode === "block") {
      if (c === "*" && next === "/") {
        mode = "code";
        i += 2;
        continue;
      }
      if (c === "\n") out += c; // keep line numbers stable
    } else {
      // inside a string: drop content (keep newlines for stable line
      // numbers), watch for escapes and the terminator
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "\n") out += c;
      if (
        (mode === "single" && c === "'") ||
        (mode === "double" && c === '"') ||
        (mode === "template" && c === "`")
      ) {
        out += c; // closing quote
        mode = "code";
      }
    }
    i++;
  }
  return out;
}

/**
 * Split top-level statements. Barrels only contain import/export
 * declarations, which end with `;` or a newline after a complete
 * brace/paren-balanced chunk — so splitting on `;` at depth 0 is enough.
 */
function topLevelStatements(code) {
  const statements = [];
  let depth = 0;
  let current = "";
  for (const ch of code) {
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    if (ch === ";" && depth === 0) {
      statements.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter(Boolean);
}

// `import\b(?!\s*[(.])` — import DECLARATIONS only: `import(` is a dynamic
// import call and `import.meta` is a runtime expression; both are logic.
const PURE_STATEMENT =
  /^(import\b(?!\s*[(.])|export\s+\*(\s+as\s+\w+)?\s+from\b|export\s+(type\s+)?\{|export\s+type\s+\w+\s*(<[^=]*>)?\s*=|export\s+interface\b)/;

/**
 * Documented exceptions. Each entry must justify why the runtime content
 * is safe to leave outside the coverage ratchet.
 */
const ALLOWLIST = new Set([
  // Data-only theme catalog: a single object literal aggregating named
  // imports (`export const themes = { ... } satisfies ...`) plus a derived
  // type. No branches, no functions — nothing coverable can hide here.
  // Moving it to a `catalog.ts` would churn the theme module for zero
  // coverage gain; if logic ever gets added, remove this entry first.
  "src/theme/themes/index.ts",
]);

/**
 * Depth-0 line starts a barrel may contain. Anything else at depth 0 is
 * logic. Guards the semicolonless case: `export * from "./a"\nconst x = f()`
 * is ONE `;`-split statement whose head matches PURE_STATEMENT, so the
 * statement check alone would let the `const` line ride through (ASI).
 * `from` / `|` / `&` cover rare-but-legal continuations of multi-line
 * re-exports and type-alias unions.
 */
const PURE_LINE_START = /^(import\b(?!\s*[(.])|export\b|from\b|\||&|$)/;

/** Offending depth-0 lines that start something other than an import/export. */
function impureTopLevelLines(code) {
  const offending = [];
  let depth = 0;
  for (const line of code.split("\n")) {
    const startDepth = depth;
    // Deliberately NOT counting <> — `=>` and comparisons would skew depth.
    for (const ch of line) {
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
    }
    if (startDepth > 0) continue; // continuation of a multi-line statement
    const trimmed = line.trim();
    // Statement fragments after a `;` on the same line are covered by the
    // statement check; here we only classify what the line STARTS with.
    if (!PURE_LINE_START.test(trimmed) && !/^[})\]]/.test(trimmed)) {
      offending.push(trimmed);
    }
  }
  return offending;
}

/** Return offending statements/lines (empty array = pure barrel). */
export function findImpureStatements(source) {
  const code = stripComments(source);
  const impureStatements = topLevelStatements(code).filter(
    (s) => !PURE_STATEMENT.test(s.replace(/\s+/g, " ")),
  );
  return [...new Set([...impureStatements, ...impureTopLevelLines(code)])];
}

function main() {
  const files = findIndexFiles(ROOT);
  let failed = false;
  for (const file of files) {
    if (ALLOWLIST.has(file)) continue;
    const offending = findImpureStatements(readFileSync(file, "utf8"));
    if (offending.length > 0) {
      failed = true;
      console.error(`\n${file}: index.ts must be a pure re-export barrel`);
      for (const s of offending.slice(0, 3)) {
        console.error(`  offending statement: ${s.split("\n")[0].slice(0, 100)}`);
      }
      console.error(
        "  Move logic to a named module (e.g. client.ts) and re-export it — " +
          "index.ts is excluded from coverage on the barrel-purity invariant (vitest.config.ts)."
      );
    }
  }
  if (failed) process.exit(1);
  console.log(`check-index-barrels: ${files.length} index.ts files are pure re-export barrels.`);
}

// Allow importing findImpureStatements in tests without running the gate.
if (process.argv[1] && process.argv[1].endsWith("check-index-barrels.mjs")) {
  main();
}
