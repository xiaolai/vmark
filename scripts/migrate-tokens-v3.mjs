#!/usr/bin/env node
// Phase 3: square width/height pairs (icon buttons / square widgets).
// Detects consecutive `width: Npx; height: Npx;` lines (same value), maps to
// icon-size or size-* token. Skip if value doesn't match the known scale.

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

// Square dim → token. Semantic preferred.
const SQUARE_MAP = {
  "14px": "--size-icon-xs",
  "18px": "--size-icon-medium",
  "20px": "--size-btn-xs",
  "22px": "--icon-size-sm",
  "24px": "--size-btn-sm",
  "26px": "--icon-size-md",
  "28px": "--icon-size-lg",
};

const WIDTH_RE = /^(\s*)width:\s+(\d+px);(\s*\/\*[^*]*\*\/)?$/;
const HEIGHT_RE = /^(\s*)height:\s+(\d+px);(\s*\/\*[^*]*\*\/)?$/;

function migrateFile(content) {
  const lines = content.split("\n");
  let changes = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const w = WIDTH_RE.exec(lines[i]);
    if (!w) continue;
    const h = HEIGHT_RE.exec(lines[i + 1]);
    if (!h) continue;
    const [, wIndent, wVal, wTail = ""] = w;
    const [, hIndent, hVal, hTail = ""] = h;
    if (wVal !== hVal) continue;            // not a square
    if (wIndent !== hIndent) continue;       // different blocks
    const tok = SQUARE_MAP[wVal];
    if (!tok) continue;
    lines[i] = `${wIndent}width: var(${tok});${wTail}`;
    lines[i + 1] = `${hIndent}height: var(${tok});${hTail}`;
    changes += 2;
  }
  return { content: lines.join("\n"), changes };
}

function main() {
  const cssFiles = execSync(`find ${ROOT}/src -name "*.css" -type f`, { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);

  let total = 0, files = 0;
  for (const abs of cssFiles) {
    const rel = abs.replace(`${ROOT}/`, "");
    if (EXCLUDED.some((re) => re.test(rel))) continue;
    const orig = readFileSync(abs, "utf8");
    const { content, changes } = migrateFile(orig);
    if (changes > 0) {
      writeFileSync(abs, content);
      console.log(`  ${String(changes).padStart(3)}  ${rel}`);
      total += changes;
      files++;
    }
  }
  console.log(`\nFiles changed: ${files}`);
  console.log(`Lines changed: ${total}`);
}

main();
