/**
 * Group 1 — Universal rules. Apply to any text, CJK or not.
 *
 * @module lib/cjkFormatter/rules/universal
 */

/**
 * Normalize spaced ellipsis patterns to standard ellipsis.
 * e.g., ". . ." → "..."
 */
export function normalizeEllipsis(text: string): string {
  // Replace spaced dots with standard ellipsis
  text = text.replace(/\s*\.\s+\.\s+\.(?:\s+\.)*/g, "...");
  // Ensure exactly one space after ellipsis when followed by non-whitespace
  text = text.replace(/\.\.\.\s*(?=\S)/g, "... ");
  return text;
}

/**
 * Collapse excessive newlines (3+) to max 2.
 * Also handles legacy <br /> tags for empty paragraphs.
 */
export function collapseNewlines(text: string): string {
  // Remove standalone <br /> lines (empty paragraphs from legacy WYSIWYG output)
  // Pattern: \n\n<br />\n\n or multiple consecutive ones
  text = text.replace(/(\n\n)(<br\s*\/?>\n\n)+/g, "\n\n");

  // Also handle <br /> at start after first paragraph
  text = text.replace(/\n\n<br\s*\/?>\n\n/g, "\n\n");

  // Collapse 3+ consecutive newlines to exactly 2
  text = text.replace(/\n{3,}/g, "\n\n");

  return text;
}
