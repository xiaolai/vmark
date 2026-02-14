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
    const code = char.codePointAt(0) || 0;
    // CJK characters have width 2
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility
      (code >= 0x3000 && code <= 0x303f) || // CJK Punctuation
      (code >= 0xff00 && code <= 0xffef) // Fullwidth Forms
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
