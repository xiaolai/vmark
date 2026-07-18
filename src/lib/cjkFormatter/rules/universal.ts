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
  // Replace spaced dots with standard ellipsis. Horizontal whitespace only —
  // dots on separate lines are sentence-ending periods, not a spaced
  // ellipsis, and collapsing them would join those lines.
  text = text.replace(/[ \t]*\.[ \t]+\.[ \t]+\.(?:[ \t]+\.)*/g, "...");
  // Ensure exactly one space after a same-line ellipsis when followed by
  // non-whitespace. Horizontal whitespace only — an ellipsis at end of line
  // must not be joined with the next line (or across a paragraph break).
  // The (?!\.) guard anchors to the END of a dot run so 4+ dots are never
  // split in the middle (e.g. "wait.... ok" stays intact).
  text = text.replace(/\.\.\.(?!\.)[ \t]*(?=\S)/g, "... ");
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
