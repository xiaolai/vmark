/**
 * The CONTENT of a markdown line, separated from its block markup.
 *
 * Purpose: converting a block to a code block asks "what is the text here?", and
 * the answer excludes the markup that made it a heading or a list item. WYSIWYG
 * gets this for free — it holds a node tree, so `### Title` is a heading node
 * whose text is `Title`. Source mode holds the raw line and had no equivalent,
 * so fencing a heading produced a code block containing the literal characters
 * `### Title`.
 *
 * Key decisions:
 *   - INDENTATION is content, not markup. Once the markers are gone it is the
 *     only thing left showing the nesting, and WYSIWYG preserves it. This is the
 *     one difference from `headingDetection.splitLine`, which discards indent
 *     because a heading conversion has no use for it.
 *   - The QUOTE wrapper is returned separately rather than dropped, because a
 *     block converted inside a blockquote stays inside it.
 *   - Exactly ONE list marker is stripped. Stripping greedily would silently
 *     tidy up a malformed `- - two` instead of showing it.
 *
 * @coordinates-with toolbarActions/sourceInsertActions.ts — insertCodeBlock
 * @coordinates-with sourceContextDetection/headingDetection.ts — the heading-only variant
 * @module plugins/shared/lineContent
 */

/** Leading blockquote markers, normalised to a single `> ` on the way out. */
const QUOTE_RE = /^\s*(?:>\s?)+/;
/** A bullet or ordered marker with optional task checkbox, WITHOUT its indent. */
const LIST_MARKER_RE = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
/** An ATX heading run. */
const HEADING_RE = /^#{1,6}(?:\s+|$)/;
/** `---`, `***`, `___` — a thematic break, not a list marker. */
const THEMATIC_BREAK_RE = /^[-*_]{3,}$/;

export interface LineContent {
  /** Blockquote wrapper to keep OUTSIDE the converted block, or "". */
  quote: string;
  /** Leading whitespace, which survives the conversion as content. */
  indent: string;
  /** The line's text with quote, indent, list marker and heading run removed. */
  content: string;
}

/** Split a markdown line into its quote wrapper, indentation, and text. */
export function stripBlockMarkup(line: string): LineContent {
  let rest = line;

  const quoteMatch = QUOTE_RE.exec(rest);
  const quote = quoteMatch ? `${quoteMatch[0].trimEnd()} ` : "";
  if (quoteMatch) rest = rest.slice(quoteMatch[0].length);

  const indent = /^\s*/.exec(rest)?.[0] ?? "";
  rest = rest.slice(indent.length);

  // A run of three or more `-`/`*`/`_` is a thematic break; treating its first
  // character as a bullet would turn `---` into a line reading `-`.
  if (!THEMATIC_BREAK_RE.test(rest.trim())) {
    const listMatch = LIST_MARKER_RE.exec(rest);
    if (listMatch) rest = rest.slice(listMatch[0].length);
  }

  const headingMatch = HEADING_RE.exec(rest);
  if (headingMatch) rest = rest.slice(headingMatch[0].length);

  // Indent is reported even inside a quote: the quote is the wrapper, and the
  // whitespace after it is the content's own nesting. Dropping it there lost the
  // structure of a quoted nested list.
  return { quote, indent, content: rest };
}
