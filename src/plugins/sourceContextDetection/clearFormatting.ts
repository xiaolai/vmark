/**
 * Clear Formatting for Source Mode
 *
 * Removes inline formatting markers from text while preserving the content.
 * Handles: bold, italic, underline, strikethrough, highlight, superscript,
 * subscript, inline code, and link syntax (extracts text from links).
 * Images are intentionally preserved unchanged.
 */

import { FORMAT_MARKERS, type WrapFormatType } from "./formatTypes";

// Link pattern: [text](url) - captures text inside brackets
const LINK_PATTERN = /\[([^\]]*)\]\([^)]*\)/g;
// Image pattern: ![alt](url) - preserved unchanged
const IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/g;

// Formats to clear, ordered by marker length (longest first for proper nesting)
const CLEARABLE_FORMATS: WrapFormatType[] = [
  "bold", // **
  "strikethrough", // ~~
  "highlight", // ==
  "underline", // ++
  "italic", // *
  "superscript", // ^
  "subscript", // ~
  "code", // `
];

/**
 * Remove a specific format marker from text.
 * Handles both wrapped text and markers around existing text.
 */
function stripFormat(text: string, format: WrapFormatType): string {
  const { prefix, suffix } = FORMAT_MARKERS[format];

  // Escape special regex characters
  const escPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Build pattern to match prefix...content...suffix
  // Require at least one character between markers (use .+? not .*?)
  const pattern = new RegExp(`${escPrefix}(.+?)${escSuffix}`, "g");

  return text.replace(pattern, "$1");
}

/**
 * Clear all inline formatting from the given text.
 *
 * - Removes bold, italic, underline, strikethrough, highlight markers
 * - Removes superscript, subscript, inline code markers
 * - Extracts text from link syntax: [text](url) → text
 * - Preserves image syntax unchanged: ![alt](url)
 *
 * @param text The markdown text to clear formatting from
 * @returns Text with inline formatting removed
 */
export function clearAllFormatting(text: string): string {
  if (!text) return text;

  // Temporarily replace images with placeholders to protect them
  const imagePlaceholders: string[] = [];
  let result = text.replace(IMAGE_PATTERN, (match) => {
    imagePlaceholders.push(match);
    return `\0IMG${imagePlaceholders.length - 1}\0`;
  });

  // Extract text from links: [text](url) → text
  result = result.replace(LINK_PATTERN, "$1");

  // Strip each format type
  for (const format of CLEARABLE_FORMATS) {
    result = stripFormat(result, format);
  }

  // Restore images
  result = result.replace(/\0IMG(\d+)\0/g, (_, index) => imagePlaceholders[Number(index)]);

  return result;
}
