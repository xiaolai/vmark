#!/usr/bin/env node
/**
 * Design Token Enforcement Script
 * Checks CSS files for design system violations.
 * Run: node scripts/check-design-tokens.mjs
 * Part of: pnpm check:all
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const args = process.argv.slice(2);
const files = args.length ? args : globSync("src/**/*.css");

const violations = [];

// Patterns to detect
const checks = [
  {
    name: "Hardcoded hex color",
    pattern: /(?<!var\([^)]*)(#[0-9a-fA-F]{3,8})(?![^(]*\))/g,
    message: "Use CSS variable token instead",
    severity: "warning", // Warning for now - too many to fix at once
    exclude: [
      /index\.css$/,           // Token definitions
      /alert-block\.css$/,     // GitHub alert colors
      /App\.css$/,             // Vite template (can be deleted)
      /editor\.css$/,          // Syntax highlighting (GitHub theme)
      /printStyles\.css$/,     // Print overrides (forces light theme)
      /exportStyles\.css$/,    // Export embeds standalone colors
      /vmark-reader\.css$/,    // Export reader bundle defines its own tokens
      /hljs-syntax\.css$/,     // Syntax-highlight palette (GitHub theme)
      /source-syntax\.css$/,   // Syntax-highlight palette (CodeMirror)
      /styles\/syntax-palette\.css$/, // Shared syntax palette (source + data trees)
    ],
  },
  {
    name: "Deprecated dark theme selector",
    pattern: /\[data-theme\s*=\s*["']night["']\]/g,
    message: "Use .dark-theme selector instead",
    severity: "error", // This should be fixed
  },
  {
    name: "Focus removal without replacement",
    pattern: /:focus\s*\{[^}]*outline:\s*none[^}]*\}/g,
    message: "Ensure visible focus indicator exists (accessibility)",
    severity: "warning", // Review manually - some have replacement indicators
  },
  {
    name: "Non-standard border-radius",
    // Note: 1px and 2px are acceptable for small elements (scrollbars, code spans, cursors)
    pattern: /border-radius:\s*(3px|5px|7px|9px|10px|12px)/g,
    message: "Use standard values: 4px, 6px, 8px, or 100px (pill)",
    severity: "warning", // Normalize gradually
  },
];

for (const file of files) {
  const content = readFileSync(file, "utf8");

  for (const check of checks) {
    // Skip excluded files
    if (check.exclude?.some((re) => re.test(file))) continue;

    let match;
    while ((match = check.pattern.exec(content)) !== null) {
      // Get line number
      const lines = content.slice(0, match.index).split("\n");
      const line = lines.length;

      violations.push({
        file,
        line,
        check: check.name,
        value: match[0].slice(0, 50),
        message: check.message,
        severity: check.severity || "error",
      });
    }
  }
}

// ── Undefined CSS custom property check (audit 20260612 H14) ────────────
// A var(--x) with no definition anywhere and no fallback is
// invalid-at-computed-value-time: the declaration silently becomes
// auto/initial (this shipped a mispositioned, unpadded export control).
// Tokens written from JS (useTheme/applyTheme) are collected from src too.
{
  const definedVars = new Set();
  const defRe = /--[A-Za-z0-9-]+(?=\s*:)/g;
  // CSS definitions across all stylesheets
  for (const file of globSync("src/**/*.css")) {
    const content = readFileSync(file, "utf8");
    for (const m of content.matchAll(defRe)) definedVars.add(m[0]);
  }
  // JS-emitted tokens: setProperty("--x", ...) and "--x": value maps
  for (const file of globSync("src/**/*.{ts,tsx}")) {
    const content = readFileSync(file, "utf8");
    for (const m of content.matchAll(/setProperty\(\s*["'`](--[A-Za-z0-9-]+)/g)) definedVars.add(m[1]);
    for (const m of content.matchAll(/["'`](--[A-Za-z0-9-]+)["'`]\s*[:,]/g)) definedVars.add(m[1]);
  }
  const useRe = /var\(\s*(--[A-Za-z0-9-]+)\s*\)/g; // no-fallback uses only
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const m of content.matchAll(useRe)) {
      const name = m[1];
      if (definedVars.has(name)) continue;
      const line = content.slice(0, m.index).split("\n").length;
      violations.push({
        file,
        line,
        check: "undefined-css-var",
        value: m[0],
        message: `var(${name}) has no definition anywhere in src/ and no fallback — the declaration is silently dropped at computed-value time.`,
        severity: "error",
      });
    }
  }
}

// Report
const errors = violations.filter((v) => v.severity === "error");
const warnings = violations.filter((v) => v.severity === "warning");

if (warnings.length > 0) {
  console.warn("\n⚠️  Design token warnings:");
  for (const v of warnings) {
    console.warn(`  ${v.file}:${v.line} - ${v.check}`);
    console.warn(`    Found: ${v.value}`);
    console.warn(`    ${v.message}\n`);
  }
}

if (errors.length > 0) {
  console.error("\n❌ Design token violations:");
  for (const v of errors) {
    console.error(`  ${v.file}:${v.line} - ${v.check}`);
    console.error(`    Found: ${v.value}`);
    console.error(`    ${v.message}\n`);
  }
  process.exit(1);
}

console.log("✅ Design token check passed.");
