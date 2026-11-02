#!/usr/bin/env node
/**
 * Purpose: refuse a `user-select` that WebKit would ignore. Run as
 * `pnpm lint:user-select`; wired into `check:static`.
 *
 * WHY. WebKit honours only `-webkit-user-select`. The production bundle gets the
 * prefix from its CSS minifier, but the dev server and the `?raw` exported reader
 * stylesheet do not pass through that step, so an unprefixed rule works in one
 * build and silently does nothing in another. An inline `style.userSelect` write
 * has no build step at all, and every test of one passes in jsdom regardless.
 *
 * Key decisions:
 *   - The pair is checked per rule block, so a neighbouring rule cannot supply
 *     the prefix.
 *   - Zero tolerance with no baseline: every site was fixed when this shipped.
 *   - `git ls-files --others` is included so a file a session has just created is
 *     read too. Test files are skipped: they may read or reset the property.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isMainModule } from "./lib/isMainModule.mjs";

const DECLARATION = /(?<![-\w])(-webkit-)?user-select\s*:\s*([^;}]+)/g;
const INLINE_WRITE = /\.style\.userSelect\s*=(?!=)/;

/** 1-based line of a character offset. */
function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text[i] === "\n") line += 1;
  return line;
}

/** Blank out comments, keeping every newline so line numbers stay true. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

/**
 * Every unpaired `user-select` declaration in a stylesheet.
 *
 * @param {string} source stylesheet text
 * @returns {{line: number, message: string}[]}
 */
export function findCssViolations(source) {
  const css = stripComments(source);
  const violations = [];

  for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
    const bodyStart = block.index + 1;
    const declarations = [...block[1].matchAll(DECLARATION)].map((match) => ({
      prefixed: match[1] !== undefined,
      value: match[2].trim(),
      offset: bodyStart + match.index,
    }));
    const prefixed = declarations.filter((d) => d.prefixed);
    const standard = declarations.filter((d) => !d.prefixed);

    for (const { value, offset } of standard) {
      if (prefixed.some((d) => d.value === value)) continue;
      violations.push({
        line: lineAt(css, offset),
        message: `user-select: ${value} has no matching -webkit-user-select`,
      });
    }
    if (standard.length > 0) continue;
    for (const { value, offset } of prefixed) {
      violations.push({
        line: lineAt(css, offset),
        message: `-webkit-user-select: ${value} has no matching user-select`,
      });
    }
  }
  return violations;
}

/**
 * Every inline `style.userSelect` write in a script.
 *
 * @param {string} source script text
 * @returns {{line: number, message: string}[]}
 */
export function findScriptViolations(source) {
  const violations = [];
  source.split("\n").forEach((text, index) => {
    if (!INLINE_WRITE.test(text)) return;
    violations.push({
      line: index + 1,
      message: "style.userSelect has no effect in WebKit; use bodyTextSelection",
    });
  });
  return violations;
}

function listFiles(root) {
  return execFileSync(
    "git",
    ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src"],
    { maxBuffer: 1 << 28 },
  )
    .toString()
    .split("\0")
    .filter(Boolean);
}

function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const files = listFiles(root);
  const isTest = (file) => /\.test\.|__tests__\//.test(file);
  const css = files.filter((file) => file.endsWith(".css"));
  const scripts = files.filter((file) => /\.tsx?$/.test(file) && !isTest(file));

  const report = [];
  for (const file of css) {
    for (const v of findCssViolations(readFileSync(path.join(root, file), "utf8"))) {
      report.push(`${file}:${v.line} ${v.message}`);
    }
  }
  for (const file of scripts) {
    for (const v of findScriptViolations(readFileSync(path.join(root, file), "utf8"))) {
      report.push(`${file}:${v.line} ${v.message}`);
    }
  }

  // Fail closed: a scan that found nothing to read is not a pass.
  if (css.length === 0 || scripts.length === 0) {
    console.error("check-user-select-prefix: no files found under src");
    process.exit(2);
  }
  if (report.length > 0) {
    console.error(`check-user-select-prefix: ${report.length} violation(s)\n${report.join("\n")}`);
    process.exit(1);
  }
  console.log(`check-user-select-prefix: ${css.length} CSS files and ${scripts.length} script files checked`);
}

if (isMainModule(import.meta.url)) main();
