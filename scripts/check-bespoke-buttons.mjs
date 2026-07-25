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
 * This counts bespoke button-ish class DEFINITIONS in src/**\/*.css and pins the
 * number in a committed baseline that may only go DOWN. Writing another
 * `__btn` class fails the gate; so does letting the baseline go stale after a
 * migration. Use `.vm-btn` (src/styles/button-shared.css) instead.
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
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkCss(p, out);
    else if (entry.endsWith(".css")) out.push(p);
  }
  return out;
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

  console.log(`✅ Bespoke-button budget held (${actual}/${limit}).`);
}
