#!/usr/bin/env node
// Phase 2 token migration — handles shorthand patterns the v1 sweep skipped.
// Targets: border shorthands, animation/transition durations, padding-side: 1px.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const EXCLUDED = [
  /^src\/styles\/index\.css$/,
  /^src\/export\/reader\/vmark-reader\.css$/,
  /^src\/plugins\/codemirror\/source-syntax\.css$/,
  /^src\/plugins\/codeBlockLineNumbers\/hljs-syntax\.css$/,
  /^src\/components\/Editor\/editor\.css$/,
];

const BORDER_W_MAP = {
  "0.5px": "--border-hairline",
  "1px": "--border-thin",
  "2px": "--border-medium",
  "4px": "--border-thick",
};

const DURATION_MAP = {
  "0.05s": "--duration-instant",
  "0.1s": "--duration-fast",
  "0.15s": "--duration-base",
  "0.2s": "--duration-medium",
  "0.3s": "--duration-slow",
  "0.6s": "--duration-slower",
  "1s": "--duration-1s",
  "1.5s": "--duration-1-5s",
  "2s": "--duration-2s",
  "5s": "--duration-5s",
};

function migrateLine(rawLine) {
  let line = rawLine;
  let changed = false;

  // 1. Border / border-{side}: <width> solid|dashed|... <color>;
  //    Only when width is at the start of value.
  const BORDER_RE = /^(\s*)(border|border-top|border-right|border-bottom|border-left):\s+(0\.5px|1px|2px|4px)(\s+[^;]+;)/;
  const bm = BORDER_RE.exec(line);
  if (bm) {
    const [, indent, prop, width, rest] = bm;
    const tok = BORDER_W_MAP[width];
    if (tok) {
      line = `${indent}${prop}: var(${tok})${rest}`;
      changed = true;
    }
  }

  // 2. Transition / animation duration: replace any standalone duration token.
  //    Match patterns like "0.15s" preceded by space and followed by space, comma, or end.
  if (/^\s*(transition|animation):/i.test(line)) {
    for (const [literal, tok] of Object.entries(DURATION_MAP)) {
      // word-boundary safe with negative lookahead/behind on alnum
      const re = new RegExp(`(^|[\\s,])(${literal.replace(".", "\\.")})(?=[\\s,;])`, "g");
      const next = line.replace(re, (_match, pre) => `${pre}var(${tok})`);
      if (next !== line) {
        line = next;
        changed = true;
      }
    }
  }

  // 3. Standalone "transition: ... duration ease" where transition already started
  //    (transition or animation values can span multi-line. We only handle single-line.)

  return { line, changed };
}

function main() {
  const cssFiles = execSync(`find ${ROOT}/src -name "*.css" -type f`, { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);

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
