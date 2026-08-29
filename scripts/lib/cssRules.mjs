/**
 * WI-UI0.2 — shared CSS parsing for the UI gates.
 *
 * Extracted from scripts/check-bespoke-buttons.mjs so the token gate, the
 * button gate and the ui-consistency gate cannot parse CSS differently: one
 * regex grammar, one comment-stripping rule, one "value of prop in body"
 * reader. Flat component CSS only — no nesting — which is what this repo
 * writes (media queries produce one outer match whose body contains the inner
 * rules; callers that care use `cssRules` on the inner text again).
 *
 * @coordinates-with scripts/check-bespoke-buttons.mjs — original home; imports from here
 * @coordinates-with scripts/check-design-tokens.mjs, scripts/check-ui-consistency.mjs
 */

/** Every `selector { body }` pair; good enough for flat component CSS. */
export const CSS_RULE_RE = /([^{}]+)\{([^{}]*)\}/g;

/** Comments out, replaced by a single space (collapses layout). */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Comments blanked but LENGTH-PRESERVING (newlines kept), so indexes into the
 * result still map to the original text — line numbers survive.
 */
export function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** The value a rule body declares for `prop`, or null. Last declaration wins. */
export function declaredValue(body, prop) {
  const re = new RegExp(`(?:^|[;{])\\s*${prop}\\s*:\\s*([^;}]+)`, "gi");
  let found = null;
  for (const m of stripComments(body).matchAll(re)) found = m[1].trim();
  return found;
}

/** 1-based line number of `index` within `text`. */
export function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/**
 * Iterate `{selector, body, index, bodyIndex, line}` over a stylesheet.
 * `selector` has comments stripped and whitespace collapsed; `index` points at
 * the first significant character of the selector in the ORIGINAL text.
 */
export function* cssRules(css) {
  const blanked = blankComments(css);
  for (const m of blanked.matchAll(CSS_RULE_RE)) {
    const rawSelector = m[1];
    const offset = rawSelector.search(/\S/);
    const index = m.index + (offset === -1 ? 0 : offset);
    yield {
      selector: rawSelector.replace(/\s+/g, " ").trim(),
      body: m[2],
      index,
      bodyIndex: m.index + rawSelector.length + 1,
      line: lineOf(css, index),
    };
  }
}
