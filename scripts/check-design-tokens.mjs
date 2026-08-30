#!/usr/bin/env node
/**
 * Design Token Enforcement Script
 * Checks CSS files for design system violations, and (WI-UI0.2) the
 * declaration-integrity checks C2a–C2g of the UI-consistency plan:
 *
 *   C2a  hardcoded hex — ERROR (was warning; the tree is measured clean
 *        outside the excluded palette files)
 *   C2b  rgb()/rgba()/hsl() literals, with the rgba-before-color-mix
 *        fallback exempted — identity baseline `rgbaLiteralDecls` (per-declaration)
 *   C2c  a custom property declared twice in one :root/.dark-theme block —
 *        zero-tolerance
 *   C2d  every referenced animation-name has a @keyframes — zero-tolerance
 *   C2e  var(--x, fallback) where --x is defined nowhere — zero-tolerance
 *   C2f  rule-31 table rows ⇄ declared tokens, zero-consumer tokens —
 *        zero-tolerance with `token-doc-ok`/`token-unused-ok` reasoned markers
 *   C2g  className strings: hex, Tailwind palette classes, text-[Npx], z-N —
 *        identity baseline `classNames`
 *
 * Baseline: scripts/design-tokens-baseline.json (identity lists, ratchet
 * down only, registered in the ratchet manifest). Fixture mode (explicit file
 * args) runs the per-file checks with no baseline, so a fixture with one
 * violation exits 1.
 *
 * Run: node scripts/check-design-tokens.mjs
 * Part of: pnpm check:all
 */
import { readFileSync, writeFileSync } from "node:fs";
import { globSync, statSync } from "node:fs";

import { pathToFileURL } from "node:url";
import {
  findColorFnLiterals,
  findDuplicateDeclarations,
  collectKeyframes,
  findMissingKeyframes,
  findUndefinedVarFallbacks,
  rule31Parity,
} from "./lib/designTokenChecks.mjs";
import { findClassNameLiterals } from "./lib/designTokensTsx.mjs";

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

/**
 * `readFileSync` with `globFiles`' race contract carried through to the read:
 * the stat filter above cannot close the window between glob and read, and a
 * scanned file CAN vanish inside it — `gha-tdd-guard.test.mjs` writes probe
 * `*.test.ts` files into `src/lib/browser/` and deletes them while the gates
 * tier runs this CLI against the real tree (the same transient that gave
 * `check-scripts-parity` a ~25% flake rate before its single-snapshot fix).
 * A vanished file is "not ours to read", exactly like a raced delete at stat
 * time; anything other than ENOENT still throws.
 *
 * @param {string} file
 * @returns {string | null} contents, or null when the file no longer exists
 */
export function readScannedFile(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

// Main guard: this module EXPORTS collectJsDefinedVars for tests, so importing
// it must not run the checker. Without it the importer's argv leaked in —
// vitest's "run" was treated as a CSS path and the import threw ENOENT.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const fileArgs = args.filter((a) => !a.startsWith("--"));
  const fixtureMode = fileArgs.length > 0;
  const files = fixtureMode ? fileArgs : globFiles("src/**/*.css");

  // Explicit fixture arguments are claims, not discoveries: a mistyped or
  // missing path must fail LOUD (readFileSync throws here, before any scan),
  // and their contents are captured NOW so even a deletion mid-run cannot
  // demote them to a quiet skip. Only glob-discovered paths get
  // readScannedFile's ENOENT tolerance.
  const fixtureContents = fixtureMode
    ? new Map(files.map((f) => [f, readFileSync(f, "utf8")]))
    : new Map();
  const readTree = (file) => fixtureContents.get(file) ?? readScannedFile(file);

  const violations = [];

  // Files whose colour literals are the point (palettes, print/export
  // overrides, token definitions). editor.css and App.css were dropped in
  // WI-UI0.2; the three syntax stylesheets left in WI-UI1.5 — the palette is
  // per-theme catalog data now (ThemeTokens.syntax), the static fallback
  // lives in index.css, and hljs-syntax.css/source-syntax.css are pure role
  // maps onto var(--syntax-*) with zero literals.
  const COLOR_EXCLUDE = [
    /index\.css$/,           // Token definitions
    /alert-block\.css$/,     // GitHub alert colors
    /printStyles\.css$/,     // Print overrides (forces light theme)
    /exportStyles\.css$/,    // Export embeds standalone colors
    /export\/reader\//,      // Self-contained reader bundle (R12, .tokenize/ignore)
  ];

  // Patterns to detect
  const checks = [
    {
      name: "Hardcoded hex color",
      pattern: /(?<!var\([^)]*)(#[0-9a-fA-F]{3,8})(?![^(]*\))/g,
      message: "Use CSS variable token instead",
      severity: "error", // C2a — the tree is measured clean outside COLOR_EXCLUDE
      exclude: COLOR_EXCLUDE,
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
    const content = readTree(file);
    if (content === null) continue;

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
  const definedVars = new Set();
  {
    const defRe = /--[A-Za-z0-9-]+(?=\s*:)/g;
    // CSS definitions across all stylesheets (and any fixture files given)
    for (const file of [...globFiles("src/**/*.css"), ...files]) {
      const content = readTree(file);
      if (content === null) continue;
      for (const m of content.matchAll(defRe)) definedVars.add(m[0]);
    }
    // JS-emitted tokens: setProperty("--x", ...) and "--x": value maps
    for (const file of globFiles("src/**/*.{ts,tsx}")) {
      const content = readTree(file);
      if (content === null) continue;
      for (const name of collectJsDefinedVars(content)) definedVars.add(name);
    }
    const useRe = /var\(\s*(--[A-Za-z0-9-]+)\s*\)/g; // no-fallback uses only
    for (const file of files) {
      const content = readTree(file);
      if (content === null) continue;
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

  // ── WI-UI0.2 declaration integrity (C2b–C2g) ─────────────────────────────
  {
    const BASELINE_PATH = "scripts/design-tokens-baseline.json";
    const baseline = fixtureMode
      ? { rgbaLiteralDecls: [], classNames: [] }
      : JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

    // C2c/C2d/C2e per file; C2b per file against the identity baseline.
    const rgbaFindings = [];
    const declaredKeyframes = new Set();
    for (const file of [...globFiles("src/**/*.css"), ...(fixtureMode ? files : [])]) {
      const keyframeSource = readTree(file);
      if (keyframeSource === null) continue;
      for (const name of collectKeyframes(keyframeSource)) declaredKeyframes.add(name);
    }
    for (const file of files) {
      const content = readTree(file);
      if (content === null) continue;
      if (!COLOR_EXCLUDE.some((re) => re.test(file))) {
        rgbaFindings.push(...findColorFnLiterals(content, file));
      }
      for (const dup of findDuplicateDeclarations(content, file)) {
        violations.push({ file, line: 0, check: "duplicate-declaration", value: dup.name, message: dup.message, severity: "error" });
      }
      for (const miss of findMissingKeyframes(content, file, declaredKeyframes)) {
        violations.push({ file, line: miss.line, check: "undeclared-keyframes", value: miss.name, message: miss.message, severity: "error" });
      }
      for (const fb of findUndefinedVarFallbacks(content, file, definedVars)) {
        violations.push({ file, line: fb.line, check: "undefined-var-fallback", value: fb.name, message: fb.message, severity: "error" });
      }
    }

    // C2g — className literals, tree mode only (the TSX surface).
    const classNameFindings = fixtureMode
      ? []
      : globFiles("src/**/*.{ts,tsx}").flatMap((file) => {
          const source = readTree(file);
          return source === null ? [] : findClassNameLiterals(source, file);
        });

    // Identity-baseline comparison for C2b + C2g: new entries and stale
    // entries both fail (house rule — record the win).
    const compare = (name, found, baselined) => {
      const foundIds = new Set(found.map((f) => f.id));
      for (const f of found) {
        if (!baselined.includes(f.id)) {
          violations.push({
            file: f.file,
            line: f.line ?? 0,
            check: name,
            value: f.token ?? f.selector ?? f.id,
            message:
              name === "rgba-literal"
                ? `rgb()/rgba()/hsl() literal. Use a token; if this is a color-mix fallback, put the color-mix on the next line for the same property.`
                : `colour/size/z literal in a className. Use a token-backed class (e.g. ring-[var(--border-color)], z-[var(--z-popup)]).`,
            severity: "error",
          });
        }
      }
      for (const id of baselined) {
        if (!foundIds.has(id)) {
          violations.push({
            file: BASELINE_PATH,
            line: 0,
            check: `${name}-stale`,
            value: id,
            message: `baselined ${name} entry now passes — record the win by removing it from ${BASELINE_PATH}.`,
            severity: "error",
          });
        }
      }
    };
    compare("rgba-literal", rgbaFindings, baseline.rgbaLiteralDecls ?? []);
    if (!fixtureMode) compare("classname-literal", classNameFindings, baseline.classNames ?? []);

    if (args.includes("--update-integrity") && !fixtureMode) {
      writeFileSync(
        BASELINE_PATH,
        `${JSON.stringify(
          { ...baseline, rgbaLiteralDecls: rgbaFindings.map((f) => f.id).sort(), classNames: classNameFindings.map((f) => f.id).sort() },
          null,
          2,
        )}\n`,
      );
      console.log(`updated ${BASELINE_PATH}`);
      process.exit(0);
    }

    // C2f — rule-31 parity, tree mode only.
    if (!fixtureMode) {
      const consumedVars = new Set();
      const useRe = /var\(\s*(--[A-Za-z0-9-]+)/g;
      const quotedRe = /["'`](--[A-Za-z0-9-]+)["'`]/g;
      for (const file of [...globFiles("src/**/*.css"), ...globFiles("src/**/*.{ts,tsx}")]) {
        const content = readTree(file);
        if (content === null) continue;
        for (const m of content.matchAll(useRe)) consumedVars.add(m[1]);
        for (const m of content.matchAll(quotedRe)) consumedVars.add(m[1]);
      }
      for (const finding of rule31Parity({
        indexCss: readFileSync("src/styles/index.css", "utf8"),
        ruleMd: readFileSync(".claude/rules/31-design-tokens.md", "utf8"),
        declaredVars: definedVars,
        consumedVars,
      })) {
        violations.push({ file: ".claude/rules/31-design-tokens.md", line: 0, check: "rule31-parity", value: "", message: finding, severity: "error" });
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
