/**
 * Group 3 — Spacing rules between CJK and Latin/punctuation.
 *
 * @module lib/cjkFormatter/rules/spacing
 */

import { CJK_NO_KOREAN } from "./shared";

/**
 * Sign characters recognised in front of a digit run (issue 898 + extensions).
 *
 * Covered:
 *   - ASCII `-` `+`
 *   - Fullwidth `－` (U+FF0D) `＋` (U+FF0B), common from CJK IMEs
 *   - Unicode minus `−` (U+2212), plus-minus `±` (U+00B1)
 *
 * Single source of truth — both sign-before-currency and sign-after-currency
 * slots in `alphanumPattern` reference this so adding/removing a sign char
 * stays in one place.
 */
const SIGN_CHAR_CLASS = "[-+−±－＋]";

/** Currency symbols allowed as a prefix to the digit run. */
const CURRENCY_CHAR_CLASS = "[$¥€£₹]";

/** Add spaces between CJK characters and English/numbers. */
export function addCJKEnglishSpacing(text: string): string {
  // Korean excluded: Korean uses native word spacing and particles attach
  // directly to preceding words (e.g., "VMark에는" not "VMark 에는").
  //
  // The pattern accepts an optional sign in two positions so all of the
  // following are treated as a single token attached to the digit run:
  //
  //   -1, +1, −1, ±1, －1, ＋1     (sign-before-currency slot, no currency)
  //   -$100, +€50, -$ 100         (sign-before-currency slot, with currency)
  //   $-100, $+100, $ -100        (sign-after-currency slot)
  //
  // The lookaheads keep hyphenated identifiers (e.g. `中文-Web`,
  // `中文+A1`) and CJK-CJK hyphenation (e.g. `中文-我`) intact:
  //   - sign-before fires only when a digit, or a currency-(maybe-space)-digit
  //     sequence, follows;
  //   - sign-after fires only when a digit follows.
  const alphanumPattern =
    `(?:${SIGN_CHAR_CLASS}(?=\\d|${CURRENCY_CHAR_CLASS}[ ]?\\d))?` +
    `(?:${CURRENCY_CHAR_CLASS}[ ]?)?` +
    `(?:${SIGN_CHAR_CLASS}(?=\\d))?` +
    "[A-Za-z0-9]+" +
    "(?:[%‰℃℉]|°[CcFf]?|[ ]?(?:USD|CNY|EUR|GBP|RMB))?";

  // CJK (non-Korean) followed by alphanumeric
  text = text.replace(
    new RegExp(`([${CJK_NO_KOREAN}])(${alphanumPattern})`, "g"),
    "$1 $2"
  );
  // Alphanumeric followed by CJK (non-Korean)
  text = text.replace(
    new RegExp(`(${alphanumPattern})([${CJK_NO_KOREAN}])`, "g"),
    "$1 $2"
  );

  return text;
}

/** Add space between CJK characters and half-width parentheses. */
export function addCJKParenthesisSpacing(text: string): string {
  // Korean excluded: Korean uses native word spacing around parentheses.
  text = text.replace(new RegExp(`([${CJK_NO_KOREAN}])\\(`, "g"), "$1 (");
  text = text.replace(new RegExp(`\\)([${CJK_NO_KOREAN}])`, "g"), ") $1");
  return text;
}

/**
 * Currency and unit binding.
 *
 * - Prefix currency symbols ($, ¥, €, £, ₹) bind tight to following number: `$ 100` → `$100`
 * - Unit symbols (%, ‰, ℃, ℉, °) bind tight to preceding number: `50 %` → `50%`
 * - Postfix currency codes (USD, CNY, EUR, GBP, RMB) are spaced from preceding number: `100USD` → `100 USD`
 */
export function fixCurrencySpacing(
  text: string,
  postfixCurrency: "tight" | "spaced" = "spaced"
): string {
  // Prefix currency symbols bind tight to following number
  text = text.replace(/([$¥€£₹])\s+(\d)/g, "$1$2");

  // Prefix currency codes bind tight to following number (style choice: keep tight)
  text = text.replace(/(USD|CNY|EUR|GBP|RMB|JPY)\s+(\d)/g, "$1$2");

  // Unit symbols bind tight to preceding number
  // Note: No word boundary assertion since these are Unicode symbols
  text = text.replace(/(\d)\s+(%|‰|℃|℉|°[CcFf]?)(?=[\s,;.。，；、！？!?)\]」』】〉》)]|$)/g, "$1$2");

  // Postfix currency codes: space or tight based on setting
  if (postfixCurrency === "spaced") {
    // Add space between number and postfix currency code if missing
    text = text.replace(/(\d)(USD|CNY|EUR|GBP|RMB|JPY)\b/g, "$1 $2");
  } else {
    // Remove space between number and postfix currency code
    text = text.replace(/(\d)\s+(USD|CNY|EUR|GBP|RMB|JPY)\b/g, "$1$2");
  }

  return text;
}

/** Remove same-line spaces around slashes (preserves URLs and line breaks). */
export function fixSlashSpacing(text: string): string {
  // Remove horizontal whitespace around / but not in URLs (avoid //).
  // [ \t] only — matching \n here would merge adjacent lines (e.g. a heading
  // with a following line that starts with an absolute path).
  return text.replace(/(?<![/:])[ \t]*\/[ \t]*(?!\/)/g, "/");
}

/** Collapse multiple spaces to single space (preserves indentation). */
export function collapseSpaces(text: string): string {
  // Match non-space + 2+ spaces to preserve leading indentation
  return text.replace(/(\S) {2,}/g, "$1 ");
}
