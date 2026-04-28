#!/usr/bin/env node
// Phase 5: standalone min/max width/height, border-spacing, padding-{side} catches v1 missed.
// Conservative: only when value maps cleanly to a token AND the property suggests
// the token's semantic role.

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

// For min/max-width/height, prefer space tokens (the value is dimensional, not radius)
const DIM_MAP = {
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

const MINMAX_RE = /^(\s*)(min-width|max-width|min-height|max-height|border-spacing):\s+(\d+(?:\.\d+)?px);(\s*\/\*[^*]*\*\/)?\s*$/;

function migrateLine(line) {
  const m = MINMAX_RE.exec(line);
  if (m) {
    const [, indent, prop, val, tail = ""] = m;
    const tok = DIM_MAP[val];
    if (tok) return { line: `${indent}${prop}: var(${tok});${tail}`, changed: true };
  }
  return { line, changed: false };
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
