#!/usr/bin/env node
// Property-aware single-value token migration sweep.
// Safe: only single-value declarations (padding: 8px;, gap: 4px;, font-size: 12px;).
// Skips multi-value shorthands and width/height (need class-context judgment).
// Skips var() expressions, calc(), color-mix(), gradients, em/% values.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

// Property → value-map mapping.
// Each value-map: literal value (without semicolon) → token name (without `var()`).
// Semantic tokens preferred; primitives fill the gaps.
const SPACING = {
  "0": null,
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

const RADIUS = {
  "4px": "--radius-sm",
  "6px": "--radius-md",
  "8px": "--radius-lg",
  "100px": "--radius-pill",
};

const FONT_SIZE = {
  "10px": "--font-size-2xs",
  "11px": "--font-size-xs",
  "12px": "--font-size-sm",
  "13px": "--font-size-base",
  "14px": "--font-size-md",
  "16px": "--font-size-lg",
};

const LINE_HEIGHT = {
  "1.25": "--line-height-tight",
  "1.35": "--line-height-snug",
  "1.4": "--line-height-base",
  "1.5": "--line-height-normal",
  "1.6": "--line-height-relaxed",
};

const LETTER_SPACING = {
  "0.3px": "--letter-spacing-tight",
  "0.5px": "--letter-spacing-loose",
};

const OPACITY = {
  "0.4": "--opacity-disabled",
  "0.5": "--opacity-muted",
  "0.6": "--opacity-subtle",
  "0.7": "--opacity-half-faded",
  "0.85": "--opacity-mostly-opaque",
};

const Z_INDEX = {
  "10": "--z-resize-handle",
  "100": "--z-bar",
  "102": "--z-toolbar",
  "103": "--z-toolbar-dropdown",
  "1000": "--z-context-menu",
  "1200": "--z-mcp-overlay",
  "9999": "--z-popup",
  "10000": "--z-table-context",
};

const BORDER_WIDTH = {
  "0.5px": "--border-hairline",
  "1px": "--border-thin",
  "2px": "--border-medium",
  "4px": "--border-thick",
};

// CSS property -> map binding
const PROP_MAPS = [
  // Spacing properties
  [/^(padding|margin|gap|row-gap|column-gap|padding-top|padding-right|padding-bottom|padding-left|margin-top|margin-right|margin-bottom|margin-left)$/, SPACING],
  // Radius
  [/^(border-radius)$/, RADIUS],
  // Font size
  [/^(font-size)$/, FONT_SIZE],
  // Line height
  [/^(line-height)$/, LINE_HEIGHT],
  // Letter spacing
  [/^(letter-spacing)$/, LETTER_SPACING],
  // Opacity
  [/^(opacity)$/, OPACITY],
  // Z-index
  [/^(z-index)$/, Z_INDEX],
  // Border width (only when standalone, not inside `border:` shorthand)
  [/^(border-width|border-top-width|border-right-width|border-bottom-width|border-left-width)$/, BORDER_WIDTH],
];

// Files to skip entirely (per .tokenize/ignore + the export bundle)
const EXCLUDED_PATHS = [
  /^src\/styles\/index\.css$/,
  /^src\/export\/reader\/vmark-reader\.css$/,
  /^src\/plugins\/codemirror\/source-syntax\.css$/,
  /^src\/plugins\/codeBlockLineNumbers\/hljs-syntax\.css$/,
  /^src\/components\/Editor\/editor\.css$/, // em-based; out of scope
];

// Match: optional indent, property, ":", optional space, value, optional `;`, optional trailing comment.
// Captures: 1=indent, 2=property, 3=value, 4=trailing (semicolon + optional comment + EOL)
const DECL_RE = /^(\s*)([a-z][a-z0-9-]*):\s+([^;\n{]+?)(\s*;[^\n]*)?$/i;

function migrateLine(line) {
  const m = DECL_RE.exec(line);
  if (!m) return { line, changed: false };

  const [, indent, property, rawValue, tail = ""] = m;
  const value = rawValue.trim();

  // Skip if already uses var() or calc() or color-mix() or url() or contains a function
  if (/^(var|calc|color-mix|rgb|rgba|hsl|hsla|url|linear-gradient|radial-gradient|min|max|clamp|attr)\(/i.test(value)) {
    return { line, changed: false };
  }

  // Skip if value contains a space (multi-value shorthand)
  if (/\s/.test(value)) return { line, changed: false };

  // Find applicable map
  let map = null;
  for (const [propRe, m] of PROP_MAPS) {
    if (propRe.test(property)) { map = m; break; }
  }
  if (!map) return { line, changed: false };

  const tokenName = map[value];
  if (!tokenName) return { line, changed: false };

  return {
    line: `${indent}${property}: var(${tokenName})${tail || ";"}`,
    changed: true,
  };
}

function isExcluded(relPath) {
  return EXCLUDED_PATHS.some((re) => re.test(relPath));
}

function processFile(absPath) {
  const original = readFileSync(absPath, "utf8");
  const lines = original.split("\n");
  let changes = 0;
  const newLines = lines.map((line) => {
    const r = migrateLine(line);
    if (r.changed) changes++;
    return r.line;
  });
  if (changes > 0) {
    writeFileSync(absPath, newLines.join("\n"));
  }
  return changes;
}

function main() {
  const cssFiles = execSync(`find ${ROOT}/src -name "*.css" -type f`, { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);

  let totalChanges = 0;
  let filesChanged = 0;
  for (const abs of cssFiles) {
    const rel = abs.replace(`${ROOT}/`, "");
    if (isExcluded(rel)) continue;
    const n = processFile(abs);
    if (n > 0) {
      console.log(`  ${String(n).padStart(3)}  ${rel}`);
      totalChanges += n;
      filesChanged++;
    }
  }
  console.log(`\nFiles changed: ${filesChanged}`);
  console.log(`Total line changes: ${totalChanges}`);
}

main();
