#!/usr/bin/env node
/**
 * Design Token Enforcement Script
 * Checks CSS files for design system violations.
 * Run: node scripts/check-design-tokens.mjs
 * Part of: pnpm check:all
 */
import { readFileSync } from "node:fs";
import { globSync, statSync } from "node:fs";

import { pathToFileURL } from "node:url";

/**
 * CSS custom properties DEFINED from JS in `source`: `setProperty("--x", …)`
 * and object-literal keys (`"--x": value`).
 *
 * The object-key pattern requires a COLON. A trailing COMMA must not count:
 * `"--x",` is an ARRAY ELEMENT — a var being *read*, not defined. Accepting it
 * made this gate miss the exact thing it exists to catch: export/themeSnapshot.ts
 * lists "--spacing-1/2/3" among the vars it snapshots via getPropertyValue,
 * which marked that whole family "defined" while nothing declared it, and 133
 * padding/margin/gap declarations across 13 components were silently dropped
 * while this check stayed green.
 */
/** A value that renders nothing, so it cannot serve as a focus indicator. */
const INVISIBLE = /^\s*(none|transparent|0|initial|unset|inherit)\s*$/;

/** Properties that can draw a visible focus affordance. */
const INDICATOR_PROP = /(?:^|[;{])\s*(background(?:-color)?|outline|border(?:-[a-z]+)*|box-shadow)\s*:\s*([^;}]+)/g;

/** Whether a declaration block paints something a sighted user can see. */
function hasVisibleIndicator(body) {
  INDICATOR_PROP.lastIndex = 0;
  let m;
  while ((m = INDICATOR_PROP.exec(body)) !== null) {
    if (!INVISIBLE.test(m[2])) return true;
  }
  return false;
}

/** Split a selector list, dropping comments. */
function selectorsOf(raw) {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * `:focus` rules that remove the outline with nothing visible taking its place.
 *
 * Two things count as a replacement, and both are deliberate:
 *
 *   1. A `:focus-visible` rule on the SAME selector that paints something. This
 *      is the dominant in-repo pattern (`background: var(--hover-bg)` beside a
 *      borderless input), and a check that cannot see it is a check nobody
 *      believes.
 *   2. An explicit `/⁎ focus: caret-only — <reason> ⁎/` marker immediately above
 *      the rule. The caret IS a valid indicator for a text input
 *      (`.claude/rules/33-focus-indicators.md` §2) but no CSS analysis can see
 *      a caret, so the claim has to be written down. The REASON is required:
 *      a bare token would just be a mute button.
 *
 * Every member of a comma-separated list needs cover — one covered selector
 * does not vouch for its neighbour.
 *
 * @param {string} css
 * @returns {{ selector: string, line: number }[]}
 */
export function findFocusRemovals(css) {
  const rules = [];
  const ruleRe = /([^{}]*)\{([^}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css)) !== null) {
    rules.push({ raw: m[1], body: m[2], index: m.index });
  }

  // Selectors whose :focus-visible rule paints something.
  const covered = new Set();
  for (const rule of rules) {
    if (!hasVisibleIndicator(rule.body)) continue;
    for (const sel of selectorsOf(rule.raw)) {
      if (sel.endsWith(":focus-visible")) covered.add(sel.slice(0, -":focus-visible".length));
    }
  }

  const findings = [];
  for (const rule of rules) {
    if (!/outline\s*:\s*none/.test(rule.body)) continue;

    const focusSelectors = selectorsOf(rule.raw).filter((s) => s.endsWith(":focus"));
    if (focusSelectors.length === 0) continue; // :focus-visible etc. are not removals

    // The marker must sit in this rule's own prelude, so it cannot leak
    // forward and excuse an unrelated rule further down the file.
    if (/focus:\s*caret-only\s*[—–-]\s*\S/.test(rule.raw)) continue;

    const bases = focusSelectors.map((s) => s.slice(0, -":focus".length));
    if (bases.every((b) => covered.has(b))) continue;

    // Point at the selector itself, not at the whitespace after the previous
    // rule's closing brace.
    const blanked = rule.raw.replace(/\/\*[\s\S]*?\*\//g, (s) => " ".repeat(s.length));
    const offset = blanked.search(/\S/);
    const start = rule.index + (offset === -1 ? 0 : offset);
    findings.push({
      selector: focusSelectors[0],
      line: css.slice(0, start).split("\n").length,
    });
  }
  return findings;
}

export function collectJsDefinedVars(source) {
  const names = new Set();
  for (const m of source.matchAll(/setProperty\(\s*["'`](--[A-Za-z0-9-]+)/g)) names.add(m[1]);
  for (const m of source.matchAll(/["'`](--[A-Za-z0-9-]+)["'`]\s*:/g)) names.add(m[1]);
  return names;
}

/**
 * `globSync` restricted to regular files.
 *
 * Vitest's browser runner writes screenshot artifacts into a `__screenshots__`
 * directory beside the test, named after the test FILE — so a directory whose
 * name ends in `.ts` exists after any `*.webkit.test.ts` failure, and those
 * directories are gitignored, i.e. expected on a developer machine. Feeding
 * it to `readFileSync` threw an unhandled `EISDIR` and killed this gate with a
 * raw Node stack trace, which reads as "the token checker is broken" rather than
 * "you have a leftover artifact".
 *
 * @param {string} pattern
 * @returns {string[]}
 */
export function globFiles(pattern) {
  return globSync(pattern).filter((p) => {
    try {
      return statSync(p).isFile();
    } catch {
      // Raced with a delete, or a broken symlink. Not ours to read either way.
      return false;
    }
  });
}

// Main guard: this module EXPORTS collectJsDefinedVars for tests, so importing
// it must not run the checker. Without it the importer's argv leaked in —
// vitest's "run" was treated as a CSS path and the import threw ENOENT.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const files = args.length ? args : globFiles("src/**/*.css");

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
    // "Focus removal without replacement" is NOT a regex check — see
    // findFocusRemovals below. A bare `:focus { outline: none }` pattern
    // flagged four sanctioned caret-only text inputs and nothing else, so it
    // was a pure false-positive generator carrying an "review manually" excuse.
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

    for (const focus of findFocusRemovals(content)) {
      violations.push({
        file,
        line: focus.line,
        check: "Focus removal without replacement",
        value: focus.selector,
        message:
          "No visible focus indicator. Add a `:focus-visible` rule that paints " +
          "something, or — for a text input where the caret is the indicator — " +
          "a `/* focus: caret-only — <reason> */` marker above the rule.",
        severity: "error", // Now precise enough to block; WCAG is not advisory.
      });
    }

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
    for (const file of globFiles("src/**/*.css")) {
      const content = readFileSync(file, "utf8");
      for (const m of content.matchAll(defRe)) definedVars.add(m[0]);
    }
    // JS-emitted tokens: setProperty("--x", ...) and "--x": value maps
    for (const file of globFiles("src/**/*.{ts,tsx}")) {
      const content = readFileSync(file, "utf8");
      for (const name of collectJsDefinedVars(content)) definedVars.add(name);
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

}
