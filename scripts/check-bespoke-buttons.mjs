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
import { CSS_RULE_RE, stripComments, declaredValue } from "./lib/cssRules.mjs";

const SRC_DIR = "src";
const BASELINE_PATH = "scripts/bespoke-buttons-baseline.json";

const CANONICAL = /^\.(vm-btn|vm-icon-btn|popup-icon-btn|universal-toolbar-btn)(--[a-z0-9-]+)?$/;
/**
 * A class whose NAME looks like a button, anywhere in a selector.
 *
 * This used to anchor at line start, so only the FIRST class of a selector was
 * ever seen and `.tiptap-editor .code-copy-btn` — a real bespoke button — was
 * absent from the budget entirely. Descendant and compound selectors are normal
 * here, so anchoring made the count quietly wrong rather than conservative.
 */
const BUTTON_CLASS_RE = /\.([a-z][a-z0-9_-]*(?:btn|button)[a-z0-9_-]*)/gi;

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
const CANONICAL_BARE = /^(vm-btn|vm-icon-btn|popup-icon-btn|universal-toolbar-btn)(--[a-z0-9-]+)?$/;
// CSS_RULE_RE / stripComments / declaredValue now live in scripts/lib/cssRules.mjs
// (WI-UI0.2), shared with the token and ui-consistency gates so the three
// cannot parse CSS differently.

/**
 * Does this rule body re-derive a button SURFACE (rather than just position or
 * colour something)? Padding plus a border or background is the shape every
 * hand-rolled button in this repo had.
 */
function stylesButtonSurface(body) {
  return /(?:^|[;{\s])padding\b/.test(body) && /(?:^|[;{\s])(?:border|background)\b/.test(body);
}

/**
 * Every class applied to a literal `<button>`, mapped to the first file that
 * applies it. Shared by both usage-based collectors — they had the same loop
 * twice, which meant a change to the supported JSX syntax could improve one
 * measurement and silently leave the other behind.
 */
export function collectClassesAppliedToButtons(tsxFiles, readFile = (p) => readFileSync(p, "utf8")) {
  const appliedToButton = new Map();
  for (const file of tsxFiles) {
    for (const m of readFile(file).matchAll(BUTTON_EL_RE)) {
      const raw = m[1] ?? m[2] ?? m[3] ?? "";
      for (const cls of raw.match(/[a-zA-Z_][\w-]*/g) ?? []) {
        if (!appliedToButton.has(cls)) appliedToButton.set(cls, file);
      }
    }
  }
  return appliedToButton;
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
  const appliedToButton = collectClassesAppliedToButtons(tsxFiles, readFile);

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

/* ------------------------------------------------------------------------- *
 * Third measurement: the control triple.
 *
 * The two budgets above count CONTROLS. They cannot see the drift that survives
 * a fully tokenised codebase: `.vm-btn` is 6/12 + radius-sm + font-sm, and
 * `.approval-dialog__btn` was 6/14 + radius-md + font-md. Both pass every token
 * check, because each value IS a token — just not the same one. Side by side
 * they read as two products.
 *
 * So this compares WHICH token was chosen, against `.vm-btn` itself rather than
 * a hardcoded copy of it, and reports a diff rather than a count — the useful
 * output is "change this to that", not "you are over budget".
 * ------------------------------------------------------------------------- */

/** The three properties that define a button's shape. */
const SHAPE_PROPERTIES = ["padding", "border-radius", "font-size"];

/**
 * Does this rule body carry an exemption WITH a stated reason?
 *
 * A regex over the raw body cannot do this: `/button-shape-ok\s*:\s*\S/` was
 * satisfied by the `*` of the closing `*​/`, so `button-shape-ok:` with nothing
 * after it read as a stated reason — precisely the mute button the required-reason
 * rule exists to forbid. So take the comment CONTENTS first, then judge the text.
 */
function hasExemptionReason(body) {
  for (const m of body.matchAll(/\/\*([\s\S]*?)\*\//g)) {
    const marker = /button-shape-ok\s*:([\s\S]*)/.exec(m[1]);
    if (!marker) continue;
    // A reason has to be words, not punctuation left over from the marker.
    if (/[a-z0-9]/i.test(marker[1])) return true;
  }
  return false;
}

/** `--token: value` declarations, for resolving one spelling against another. */
export function buildTokenMap(css) {
  const map = new Map();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) {
    map.set(m[1].trim(), m[2].trim());
  }
  return map;
}

/**
 * Resolve `var(--x)` to its literal so `6px 12px` and
 * `var(--space-1-5) var(--space-3)` compare equal. Comparing authored TEXT
 * would flag a same-shape control for spelling its values differently, which is
 * a false positive, and a gate that cries wolf gets routed around.
 *
 * An unknown token resolves to itself rather than to a guess.
 */
export function resolveValue(value, tokens) {
  let out = String(value).trim();
  for (let i = 0; i < 5; i++) {
    const next = out.replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,[^()]*)?\)/gi, (whole, name) =>
      tokens.has(name) ? tokens.get(name) : whole,
    );
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * The canonical triple, read from `.vm-btn` in button-shared.css.
 *
 * Read rather than hardcoded: a copy here would be a fourth surface to keep in
 * sync, which is the exact defect this gate exists to catch. Fails closed — if
 * the primitive is renamed or stops declaring one of the three, that is a
 * finding, not a reason to skip the check.
 */
export function canonicalTriple(css) {
  const block = /(?:^|})[^{}]*\.vm-btn\s*\{([^{}]*)\}/m.exec(`}${css}`);
  if (!block) throw new Error("Cannot find a `.vm-btn` rule in the shared button stylesheet.");
  const triple = {};
  for (const prop of SHAPE_PROPERTIES) {
    const value = declaredValue(block[1], prop);
    if (!value) throw new Error(`\`.vm-btn\` no longer declares \`${prop}\`; the canonical triple is incomplete.`);
    triple[prop] = value;
  }
  return triple;
}

/**
 * Classes applied to a `<button>` whose declared shape diverges from canonical.
 *
 * Only the BASE rule counts. Bodies are concatenated per class elsewhere in this
 * file, which is fine for "does this re-derive a surface" but wrong here: a
 * `:focus-visible::after` ring legitimately carries its own `border-radius`, and
 * folding it in would report every correctly-built button as drift.
 *
 * A property the class never declares is not drift — it inherits, or it does not
 * care. Only an explicit, different choice is reported.
 */
export function collectShapeDrift(tsxFiles, cssFiles, { canonical, tokens }, readFile = (p) => readFileSync(p, "utf8")) {
  const appliedToButton = collectClassesAppliedToButtons(tsxFiles, readFile);

  // Base rules only: a selector mentioning the class with no pseudo attached.
  const baseBody = new Map();
  for (const file of cssFiles) {
    for (const rule of readFile(file).matchAll(CSS_RULE_RE)) {
      // Comments are folded into the selector capture by CSS_RULE_RE, so a
      // colon inside one (this repo writes `/* focus: caret-only … */` above
      // real rules) made the whole base rule look like a pseudo-selector and
      // vanish. Strip comments before deciding.
      const selector = stripComments(rule[1]);
      for (const part of selector.split(",")) {
        if (part.includes(":")) continue;
        for (const cls of part.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
          baseBody.set(cls[1], (baseBody.get(cls[1]) ?? "") + rule[2]);
        }
      }
    }
  }

  const found = new Map();
  for (const [cls, file] of appliedToButton) {
    if (CANONICAL_BARE.test(cls)) continue;
    const body = baseBody.get(cls);
    if (!body || hasExemptionReason(body)) continue;

    const diffs = [];
    for (const prop of SHAPE_PROPERTIES) {
      const actual = declaredValue(body, prop);
      if (actual === null) continue;
      if (resolveValue(actual, tokens) === resolveValue(canonical[prop], tokens)) continue;
      diffs.push({ property: prop, actual, expected: canonical[prop] });
    }
    if (diffs.length) found.set(cls, { file, diffs });
  }
  return found;
}

/** Distinct bespoke button class names defined across the given CSS sources. */
export function collectBespokeButtons(files, readFile = (p) => readFileSync(p, "utf8")) {
  const found = new Map(); // class -> file
  for (const file of files) {
    // Selectors only, comments stripped: a class NAMED in a comment is prose,
    // and a declaration value is not a definition.
    for (const rule of stripComments(readFile(file)).matchAll(CSS_RULE_RE)) {
      for (const m of rule[1].matchAll(BUTTON_CLASS_RE)) {
        const cls = `.${m[1]}`;
        if (CANONICAL.test(cls)) continue;
        if (!found.has(cls)) found.set(cls, file);
      }
    }
  }
  return found;
}

/**
 * Compare one measured count against its committed budget.
 *
 * Extracted because the CLI below did this three times — once per budget — with
 * the integer check, the over-budget branch and the stale-budget branch copied
 * verbatim each time. Three copies of a two-way ratchet is three places for the
 * "never raise it" half to be dropped from.
 *
 * Returns `null` when the budget is held; otherwise `{ kind, message }` where
 * `kind` is `invalid` | `over` | `stale`. The caller supplies `overDetail`
 * because each budget names different things and points at a different remedy.
 *
 * @returns {{kind: "invalid"|"over"|"stale", message: string} | null}
 */
export function ratchetVerdict({ key, limit, actual, noun, overDetail = "" }) {
  if (!Number.isInteger(limit)) {
    return { kind: "invalid", message: `❌ ${BASELINE_PATH} needs an integer \`${key}\`.` };
  }
  if (actual > limit) {
    return {
      kind: "over",
      message:
        `\n❌ ${actual} ${noun}, budget is ${limit}.\n\n` +
        overDetail +
        `\n\n   Do NOT raise the budget.\n`,
    };
  }
  if (actual < limit) {
    return {
      kind: "stale",
      message:
        `\n❌ Budget is stale: ${actual} ${noun} remain but the budget says ${limit}.\n` +
        `   Lower \`${key}\` to ${actual} in ${BASELINE_PATH} to lock the win in.\n`,
    };
  }
  return null;
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
  const found = collectBespokeButtons(walkCss(SRC_DIR));
  const actual = found.size;
  const nameVerdict = ratchetVerdict({
    key: "maxBespokeButtonClasses",
    limit,
    actual,
    noun: "bespoke button classes",
    overDetail:
      [...found.entries()]
        .slice(0, 10)
        .map(([c, f]) => `  ${c}  (${f})`)
        .join("\n") +
      "\n\n   Use `.vm-btn` from src/styles/button-shared.css, or `.popup-icon-btn`" +
      "\n   for icon-only buttons inside popups.",
  });
  if (nameVerdict) {
    console.error(nameVerdict.message);
    process.exit(1);
  }

  // Second, usage-based budget: classes applied to a <button> whose CSS
  // re-derives a button surface. Naming cannot evade this one.
  const styled = collectStyledButtonClasses(walkExt(SRC_DIR, ".tsx"), walkCss(SRC_DIR));
  const styledVerdict = ratchetVerdict({
    key: "maxStyledButtonClasses",
    limit: baseline.maxStyledButtonClasses,
    actual: styled.size,
    noun: "classes that style a <button> without the canonical primitive",
    overDetail:
      [...styled.entries()]
        .slice(0, 10)
        .map(([c, f]) => `  .${c}  (${f})`)
        .join("\n") + "\n\n   Use `.vm-btn` from src/styles/button-shared.css.",
  });
  if (styledVerdict) {
    console.error(styledVerdict.message);
    process.exit(1);
  }

  // Third, SHAPE: which token each button picked, not merely that it picked one.
  let canonical;
  try {
    canonical = canonicalTriple(readFileSync("src/styles/button-shared.css", "utf8"));
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
  const tokens = buildTokenMap(readFileSync("src/styles/index.css", "utf8"));
  const shape = collectShapeDrift(walkExt(SRC_DIR, ".tsx"), walkCss(SRC_DIR), { canonical, tokens });
  const shapeVerdict = ratchetVerdict({
    key: "maxShapeDriftClasses",
    limit: baseline.maxShapeDriftClasses,
    actual: shape.size,
    noun: "button classes that diverge from the canonical control shape",
    // Report the DIFF, not the count: the useful output is "change this to
    // that". A number tells you a rule was broken; this tells you how to fix it.
    overDetail:
      [...shape.entries()]
        .slice(0, 8)
        .map(
          ([cls, { file, diffs }]) =>
            `  .${cls}  (${file})\n` +
            diffs.map((d) => `      ${d.property}: ${d.actual}  ≠  ${d.expected}`).join("\n"),
        )
        .join("\n") +
      "\n\n   Canonical is `.vm-btn` (src/styles/button-shared.css): " +
      SHAPE_PROPERTIES.map((p) => `${p} ${canonical[p]}`).join(", ") +
      ".\n   Adopt the primitive, promote a genuinely-missing variant onto it, or — if the" +
      "\n   deviation is justified — record it in the rule body as" +
      "\n   `/* button-shape-ok: <reason> */`. A bare marker with no reason is rejected.",
  });
  if (shapeVerdict) {
    console.error(shapeVerdict.message);
    process.exit(1);
  }

  console.log(
    `✅ Bespoke-button budgets held (${actual}/${limit} by name, ` +
      `${styled.size}/${baseline.maxStyledButtonClasses} by usage, ` +
      `${shape.size}/${baseline.maxShapeDriftClasses} by shape).`,
  );
}
