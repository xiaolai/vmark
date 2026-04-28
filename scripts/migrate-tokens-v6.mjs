#!/usr/bin/env node
// Phase 6: mixed shorthands containing both var() and literals.
// e.g.  padding: var(--spacing-3) 14px var(--spacing-2); → 14px → var(--space-3-5)
// Also: inset: <value>;

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

// padding/margin/gap/inset shorthands that may contain mixed var() + literal values.
const SHORT_RE = /^(\s*)(padding|margin|gap|row-gap|column-gap|inset):\s+([^;\n]+);(\s*\/\*[^*]*\*\/)?\s*$/;

function migrateLine(line) {
  const m = SHORT_RE.exec(line);
  if (!m) return { line, changed: false };
  const [, indent, prop, valuesRaw, tail = ""] = m;

  // Tokenize values, treating var(...) atomically.
  // Split on whitespace, but reassemble var() expressions if split.
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of valuesRaw + " ") {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (cur) { parts.push(cur); cur = ""; }
    } else {
      cur += ch;
    }
  }

  // Skip if no literal px value to migrate
  const hasLiteral = parts.some((v) => /^\d+(\.\d+)?px$/.test(v) && SPACING_MAP[v]);
  if (!hasLiteral) return { line, changed: false };

  // Tokenize
  const newParts = parts.map((v) => {
    if (v.startsWith("var(")) return v;
    if (v === "0" || v === "auto") return v;
    const tok = SPACING_MAP[v];
    return tok ? `var(${tok})` : v;
  });

  return {
    line: `${indent}${prop}: ${newParts.join(" ")};${tail}`,
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
