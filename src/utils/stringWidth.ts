/**
 * String Width Utilities
 *
 * Purpose: Calculates display width of strings accounting for CJK characters
 * that occupy 2 columns in monospaced contexts (table alignment, code blocks).
 *
 * @coordinates-with tableParser.ts — table formatting relies on accurate column widths
 * @coordinates-with sourceContextDetection/tableDetection.ts — table formatting in source mode
 * @module utils/stringWidth
 */

/**
 * Get display width of a string (handles CJK characters as width 2).
 * Used for table formatting to achieve visual alignment.
 */
export function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    /* v8 ignore next -- @preserve codePointAt(0) is always defined when iterating string chars */
    const code = char.codePointAt(0) || 0;
    // CJK characters have width 2
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility
      (code >= 0x3000 && code <= 0x303f) || // CJK Punctuation
      (code >= 0x3040 && code <= 0x309f) || // Hiragana
      (code >= 0x30a0 && code <= 0x30ff) || // Katakana
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
      (code >= 0x20000 && code <= 0x2fffd) || // CJK Extension B+ (supplementary plane)
      // Halfwidth and Fullwidth Forms block (FF00-FFEF): only the
      // FULLWIDTH sub-ranges are wide. Halfwidth Katakana (FF65-FF9F),
      // halfwidth Hangul (FFA0-FFDC), and halfwidth signs (FFE8-FFEE)
      // are East Asian Width "H" — width 1.
      (code >= 0xff01 && code <= 0xff60) || // Fullwidth ASCII/punct variants
      (code >= 0xffe0 && code <= 0xffe6) // Fullwidth signs (￠￡￢￣￤￥￦)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Pad a string to target display width with trailing spaces.
 */
export function padToWidth(str: string, targetWidth: number): string {
  const currentWidth = getDisplayWidth(str);
  const padding = Math.max(0, targetWidth - currentWidth);
  return str + " ".repeat(padding);
}
