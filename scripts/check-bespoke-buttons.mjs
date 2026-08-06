#!/usr/bin/env node
/**
 * Bespoke-button budget gate.
 *
 * VMark had 90 hand-rolled button classes against 2 canonical ones, so each
 * feature re-derived "a bordered secondary button" from the token catalogue
 * independently — and they disagreed. Four implementations of the same control
 * used four paddings, three radii, two font sizes, and three spellings of a 1px
 * border, one of which (`--space-px`) is a SPACING token misused as a border
 * width. That drift is invisible to the design-token gate, which only checks
 * that *a* token was used, never that the right one was, or that the control
 * should have existed at all.
 *
 * TWO budgets, each pinned in a committed baseline that may only go DOWN.
 * Writing another bespoke button fails the gate; so does letting a baseline go
 * stale after a migration. Use `.vm-btn` (src/styles/button-shared.css).
 *
 *   1. BY NAME — button-ish class DEFINITIONS in src/**\/*.css.
 *   2. BY USAGE — classes applied to a `<button>` whose CSS re-derives a button
 *      surface. The name check alone was evadable: `.workspace-approval-approve`
 *      styled a real button and contained neither "btn" nor "button", so it was
 *      never counted and the budget read 88/88 while drift was happening. 61 of
 *      the 80 it finds are invisible to check 1.
 *
 * Not counted (canonical, and legitimately distinct shapes):
 *   - .vm-btn / .vm-btn--*        the primitive itself
 *   - .popup-icon-btn / --*       icon-only square buttons inside popups
 *   - .universal-toolbar-btn      the editor toolbar's own button
 *
 * Mirrors scripts/check-file-size.mjs and check-extension-budget.mjs.
 *
 * Usage: node scripts/check-bespoke-buttons.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = "src";
const BASELINE_PATH = "scripts/bespoke-buttons-baseline.json";

const CANONICAL = /^\.(vm-btn|popup-icon-btn|universal-toolbar-btn)(--[a-z0-9-]+)?$/;
/** A CSS rule defining a class whose name looks like a button. */
const BUTTON_CLASS_RE = /^\s*(\.[a-z][a-z0-9_-]*(?:btn|button)[a-z0-9_-]*)\s*(?=[,{:])/gim;

function walkCss(dir, out = []) {
  return walkExt(dir, ".css", out);
}

/** Every file under `dir` with the given extension, tests excluded. */
function walkExt(dir, ext, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkExt(p, ext, out);
    else if (entry.endsWith(ext) && !entry.includes(".test.")) out.push(p);
  }
  return out;
}

/** Classes applied to a literal `<button>` element in TSX. */
const BUTTON_EL_RE =
  /<button\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/gs;
/** Canonical names as they appear in JSX (no leading dot). */
const CANONICAL_BARE = /^(vm-btn|popup-icon-btn|universal-toolbar-btn)(--[a-z0-9-]+)?$/;
/** Every `selector { body }` pair; good enough for flat component CSS. */
const CSS_RULE_RE = /([^{}]+)\{([^{}]*)\}/g;

/**
 * Does this rule body re-derive a button SURFACE (rather than just position or
 * colour something)? Padding plus a border or background is the shape every
 * hand-rolled button in this repo had.
 */
function stylesButtonSurface(body) {
  return /(?:^|[;{\s])padding\b/.test(body) && /(?:^|[;{\s])(?:border|background)\b/.test(body);
}

/**
 * Bespoke button classes found by USAGE rather than by name.
 *
 * The name-based collector above only sees classes containing "btn"/"button",
 * so `.workspace-approval-approve` — which styled a real button with its own
 * padding, radius and border — was invisible to the budget. This keys on the
 * pairing that actually defines the problem: a class applied to a `<button>`
 * whose CSS re-derives a button surface. A class cannot evade it by naming.
 *
 * Known limits, deliberate: only literal `className` strings and template
 * literals are read (not `clsx()`/computed names), and only literal `<button>`
 * elements (not components that render one). It under-counts rather than
 * inventing violations.
 */
export function collectStyledButtonClasses(
  tsxFiles,
  cssFiles,
  readFile = (p) => readFileSync(p, "utf8"),
) {
  const appliedToButton = new Map(); // class -> first file that applies it
  for (const file of tsxFiles) {
    for (const m of readFile(file).matchAll(BUTTON_EL_RE)) {
      const raw = m[1] ?? m[2] ?? m[3] ?? "";
      for (const cls of raw.match(/[a-zA-Z_][\w-]*/g) ?? []) {
        if (!appliedToButton.has(cls)) appliedToButton.set(cls, file);
      }
    }
  }

  const bodyByClass = new Map(); // class -> concatenated declarations
  for (const file of cssFiles) {
    for (const rule of readFile(file).matchAll(CSS_RULE_RE)) {
      for (const cls of rule[1].matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
        bodyByClass.set(cls[1], (bodyByClass.get(cls[1]) ?? "") + rule[2]);
      }
    }
  }

  const found = new Map();
  for (const [cls, file] of appliedToButton) {
    if (CANONICAL_BARE.test(cls)) continue;
    const body = bodyByClass.get(cls);
    if (body && stylesButtonSurface(body)) found.set(cls, file);
  }
  return found;
}

/** Distinct bespoke button class names defined across the given CSS sources. */
export function collectBespokeButtons(files, readFile = (p) => readFileSync(p, "utf8")) {
  const found = new Map(); // class -> file
  for (const file of files) {
    for (const m of readFile(file).matchAll(BUTTON_CLASS_RE)) {
      const cls = m[1];
      if (CANONICAL.test(cls)) continue;
      if (!found.has(cls)) found.set(cls, file);
    }
  }
  return found;
}

// Only run the gate when executed directly, so tests can import the helpers.
if (process.argv[1] && process.argv[1].endsWith("check-bespoke-buttons.mjs")) {
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (error) {
    console.error(`❌ Cannot read ${BASELINE_PATH}: ${error.message}`);
    process.exit(1);
  }

  const limit = baseline.maxBespokeButtonClasses;
  if (!Number.isInteger(limit)) {
    console.error(`❌ ${BASELINE_PATH} needs an integer \`maxBespokeButtonClasses\`.`);
    process.exit(1);
  }

  const found = collectBespokeButtons(walkCss(SRC_DIR));
  const actual = found.size;

  if (actual > limit) {
    const sample = [...found.entries()].slice(0, 10).map(([c, f]) => `  ${c}  (${f})`);
    console.error(
      `\n❌ ${actual} bespoke button classes, budget is ${limit}.\n\n` +
        sample.join("\n") +
        `\n\n   Do NOT raise the budget. Use \`.vm-btn\` from src/styles/button-shared.css,\n` +
        `   or \`.popup-icon-btn\` for icon-only buttons inside popups.\n`
    );
    process.exit(1);
  }

  if (actual < limit) {
    console.error(
      `\n❌ Budget is stale: ${actual} bespoke button classes remain but the budget says ${limit}.\n` +
        `   Lower \`maxBespokeButtonClasses\` to ${actual} in ${BASELINE_PATH} to lock the win in.\n`
    );
    process.exit(1);
  }

  // Second, usage-based budget: classes applied to a <button> whose CSS
  // re-derives a button surface. Naming cannot evade this one.
  const styledLimit = baseline.maxStyledButtonClasses;
  if (!Number.isInteger(styledLimit)) {
    console.error(`❌ ${BASELINE_PATH} needs an integer \`maxStyledButtonClasses\`.`);
    process.exit(1);
  }

  const styled = collectStyledButtonClasses(walkExt(SRC_DIR, ".tsx"), walkCss(SRC_DIR));
  const styledActual = styled.size;

  if (styledActual > styledLimit) {
    const sample = [...styled.entries()].slice(0, 10).map(([c, f]) => `  .${c}  (${f})`);
    console.error(
      `\n❌ ${styledActual} classes style a <button> without using the canonical primitive, budget is ${styledLimit}.\n\n` +
        sample.join("\n") +
        `\n\n   Do NOT raise the budget. Use \`.vm-btn\` from src/styles/button-shared.css.\n`
    );
    process.exit(1);
  }

  if (styledActual < styledLimit) {
    console.error(
      `\n❌ Budget is stale: ${styledActual} button-styling classes remain but the budget says ${styledLimit}.\n` +
        `   Lower \`maxStyledButtonClasses\` to ${styledActual} in ${BASELINE_PATH} to lock the win in.\n`
    );
    process.exit(1);
  }

  console.log(
    `✅ Bespoke-button budgets held (${actual}/${limit} by name, ${styledActual}/${styledLimit} by usage).`
  );
}
