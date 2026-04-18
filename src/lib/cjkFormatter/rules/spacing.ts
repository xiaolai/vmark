/**
 * Group 3 — Spacing rules between CJK and Latin/punctuation.
 *
 * @module lib/cjkFormatter/rules/spacing
 */

import { CJK_NO_KOREAN } from "./shared";

/** Add spaces between CJK characters and English/numbers. */
export function addCJKEnglishSpacing(text: string): string {
  // Korean excluded: Korean uses native word spacing and particles attach
  // directly to preceding words (e.g., "VMark에는" not "VMark 에는").
  const alphanumPattern =
    "(?:[$¥€£₹][ ]?)?[A-Za-z0-9]+(?:[%‰℃℉]|°[CcFf]?|[ ]?(?:USD|CNY|EUR|GBP|RMB))?";

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

/** Remove spaces around slashes (preserves URLs). */
export function fixSlashSpacing(text: string): string {
  // Remove spaces around / but not in URLs (avoid //)
  return text.replace(/(?<![/:])\s*\/\s*(?!\/)/g, "/");
}

/** Collapse multiple spaces to single space (preserves indentation). */
export function collapseSpaces(text: string): string {
  // Match non-space + 2+ spaces to preserve leading indentation
  return text.replace(/(\S) {2,}/g, "$1 ");
}
