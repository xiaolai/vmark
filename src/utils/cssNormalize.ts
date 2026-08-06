/**
 * CSS text normalization — one implementation, used by every CSS check.
 *
 * Purpose: a security scan of a CSS value has to see what the CSS PARSER
 * sees, not the bytes as written. Three things hide a blocked token from a
 * literal comparison, and all three are valid CSS:
 *
 *   comments        `position:fixed/**\/`   → `position:fixed`
 *   hex escapes     `u\72l(…)`              → `url(…)`
 *   simple escapes  `f\ixed`                → `fixed`
 *
 * `styleSafety.ts` and `svgResourcePolicy.ts` each grew a partial copy of
 * this — both handled hex escapes, neither handled simple escapes, and only
 * one handled comments. Divergent copies of a normalizer are divergent
 * security behaviour, so there is exactly one here.
 *
 * @coordinates-with styleSafety.ts — declaration and stylesheet filtering
 * @coordinates-with svgResourcePolicy.ts — url() reference scanning
 * @module utils/cssNormalize
 */

/**
 * Resolve comments and escapes so a scan sees the parsed form.
 *
 * A hex escape consumes one optional trailing whitespace character, per the
 * CSS syntax spec; a simple escape is a backslash before any other single
 * character and stands for that character.
 */
export function normalizeCss(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (whole, hex: string) => {
      const code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .replace(/\\([^\n\r\f])/g, "$1");
}
