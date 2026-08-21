/**
 * Group 1 — Universal rules. Apply to any text, CJK or not.
 *
 * @coordinates-with script.ts — adjacentScript picks the ellipsis shape
 * @module lib/cjkFormatter/rules/universal
 */

import { adjacentScript } from "./script";

/**
 * Normalize ellipsis patterns, in the shape the surrounding script uses.
 *
 * There is no single correct output (WI-CJKF5.2):
 *
 * | | Chinese | Japanese | Korean | Latin |
 * |---|---|---|---|---|
 * | glyph | `……` (GB/T 15834) | `……` (JIS X 4051) | `…` | `...` |
 * | space after | no | no | no | yes |
 *
 * This produced `...` plus a trailing space for all four, so `然后...继续`
 * came back as `然后... 继续` — the wrong glyph, and a space that fullwidth
 * punctuation never takes.
 *
 * The script comes from the run's ADJACENT characters, not from the document;
 * see ./script.ts for why a document-level guess is the wrong instrument.
 */
export function normalizeEllipsis(text: string): string {
  // Replace spaced dots with standard ellipsis. Horizontal whitespace only —
  // dots on separate lines are sentence-ending periods, not a spaced
  // ellipsis, and collapsing them would join those lines.
  text = text.replace(/[ \t]*\.[ \t]+\.[ \t]+\.(?:[ \t]+\.)*/g, "...");

  // The (?!\.) guard anchors to the END of a dot run so 4+ dots are never
  // split in the middle (e.g. "wait.... ok" stays intact). `[ \t]*` only — an
  // ellipsis at end of line must not be joined with the next line.
  //
  // A space the author typed BEFORE the run is left alone, deliberately: this
  // rule only decides the run's own shape, and `中文 ...` is not attached to
  // 中文 by the same adjacency test everything else here uses. Deleting
  // authored whitespace is the limit WI-CJKF3.3 also declines to cross.
  text = text.replace(/\.\.\.(?!\.)([ \t]*)/g, (whole, gap: string, offset: number) => {
    const script = adjacentScript(text, offset, offset + whole.length);
    if (script === "han") return "……";
    if (script === "hangul") return "…";
    // Latin: exactly one space, and only when something follows on this line.
    const rest = text.slice(offset + whole.length);
    return rest.length > 0 && !/^[\r\n]/.test(rest) ? "... " : `...${gap}`;
  });

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
