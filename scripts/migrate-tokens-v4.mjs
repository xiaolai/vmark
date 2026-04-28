#!/usr/bin/env node
// Phase 4: multi-value spacing shorthands.
// Handles padding/margin/gap with 2/3/4 values. For each value:
//   - If 0 → keep literal (never tokenize)
//   - If maps to a token → use the token
//   - Else → keep literal
// At least one token replacement is required for the line to change.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const EXCLUDED = [
  /^src\/styles\/index\.css$/,
  /^src\/export\/reader\//,
  /^src\/plugins\/codemirror\/source-syntax\.css$/,
  /^src\/plugins\/codeBlockLineNumbers\/hljs-syntax\.css$/,
  /^src\/components\/Editor\/editor\.css$/,
];

const SPACING_MAP = {
  "1px": "--space-px",
  "2px": "--space-half",
  "4px": "--spacing-1",
  "6px": "--space-1-5",
  "8px": "--spacing-2",
  "10px": "--space-2-5",
  "12px": "--spacing-3",
  "14px": "--space-3-5",
  "16px": "--space-4",
  "20px": "--space-5",
  "24px": "--space-6",
  "28px": "--space-7",
  "32px": "--space-8",
  "40px": "--space-10",
  "48px": "--space-12",
  "60px": "--space-15",
};

function tokenizeValue(v) {
  if (v === "0") return "0";
  const tok = SPACING_MAP[v];
  return tok ? `var(${tok})` : v;
}

// Match: padding/margin/gap: VAL VAL [VAL [VAL]];
const SHORT_RE = /^(\s*)(padding|margin|gap|row-gap|column-gap):\s+([^;\n]+);(\s*\/\*[^*]*\*\/)?\s*$/;

function migrateLine(line) {
  const m = SHORT_RE.exec(line);
  if (!m) return { line, changed: false };
  const [, indent, prop, valuesRaw, tail = ""] = m;
  const values = valuesRaw.trim().split(/\s+/);

  // Skip if any value is var()/calc()/etc. — those mean already partially tokenized
  if (values.some((v) => /\bvar\(|calc\(|color-mix\(|rgb|rgba|hsl|hsla\(|inherit|initial|unset|auto|none/.test(v))) {
    return { line, changed: false };
  }

  // Skip single value (handled by v1)
  if (values.length === 1) return { line, changed: false };

  // Validate every value is a recognizable spacing literal or 0 or token-mappable
  const eligible = values.every((v) => v === "0" || /^-?\d+(\.\d+)?(px|em|rem)$/.test(v));
  if (!eligible) return { line, changed: false };

  const newValues = values.map(tokenizeValue);
  const replaced = newValues.filter((nv, i) => nv !== values[i]).length;
  if (replaced === 0) return { line, changed: false };

  return {
    line: `${indent}${prop}: ${newValues.join(" ")};${tail}`,
    changed: true,
  };
}

function main() {
  const cssFiles = execSync(`find ${ROOT}/src -name "*.css" -type f`, { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);

  let total = 0, files = 0;
  for (const abs of cssFiles) {
    const rel = abs.replace(`${ROOT}/`, "");
    if (EXCLUDED.some((re) => re.test(rel))) continue;
    const orig = readFileSync(abs, "utf8");
    const lines = orig.split("\n");
    let n = 0;
    const out = lines.map((l) => {
      const r = migrateLine(l);
      if (r.changed) n++;
      return r.line;
    });
    if (n > 0) {
      writeFileSync(abs, out.join("\n"));
      console.log(`  ${String(n).padStart(3)}  ${rel}`);
      total += n;
      files++;
    }
  }
  console.log(`\nFiles changed: ${files}`);
  console.log(`Lines changed: ${total}`);
}

main();
