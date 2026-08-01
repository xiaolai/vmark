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
 * `fenceRanges` lives here as the fence scanner the SAFETY BOUNDARY resolves
 * through — pairing cannot be decided locally, since a run of backticks above
 * the cursor may itself be a closer. It is not yet the only one in the codebase;
 * see its own doc comment.
 *
 * @module plugins/shared/lineContent
 */

/**
 * Leading blockquote markers. CommonMark allows at most THREE spaces of indent
 * before the marker — at four it is indented code, and `    > literal` must keep
 * its `>` as content rather than lose it as markup.
 */
const QUOTE_RE = /^ {0,3}(?:>\s?)+/;
/**
 * A bullet or ordered marker with optional task checkbox, WITHOUT its indent.
 * CommonMark caps an ordered marker at NINE digits, so `1234567890. text` is a
 * paragraph and must keep its number.
 */
const LIST_MARKER_RE = /^(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/;
/** An ATX heading run. */
const HEADING_RE = /^#{1,6}(?:\s+|$)/;
/**
 * A thematic break: three or more of the SAME `-`, `*` or `_`, which CommonMark
 * lets you separate with spaces or tabs. Matching only unbroken runs meant
 * `- - -` and `* * *` read as list items and had their first marker stripped,
 * turning a horizontal rule into `- -`.
 */
const THEMATIC_BREAK_RE = /^(?:([-*_])[ \t]*)(?:\1[ \t]*){2,}$/;

export interface LineContent {
  /** Blockquote wrapper to keep OUTSIDE the converted block, or "". */
  quote: string;
  /** Leading whitespace, which survives the conversion as content. */
  indent: string;
  /** The line's text with quote, indent, list marker and heading run removed. */
  content: string;
}

/**
 * Whether `indent` reaches the indented-code threshold: four COLUMNS, a tab
 * counting as one whole stop. Past it the line is literal code and nothing on
 * it is markup.
 */
function isCodeIndent(indent: string): boolean {
  return indent.includes("\t") || indent.length >= 4;
}

/** Split a markdown line into its quote wrapper, indentation, and text. */
export function stripBlockMarkup(line: string): LineContent {
  let rest = line;

  // `trim`, not `trimEnd`: the 0-3 spaces CommonMark allows before a `>` are
  // insignificant, and carrying them into the marker made a re-emitted quote
  // line start with stray indentation.
  const quoteMatch = QUOTE_RE.exec(rest);
  const quote = quoteMatch ? `${quoteMatch[0].trim()} ` : "";
  if (quoteMatch) rest = rest.slice(quoteMatch[0].length);

  // Spaces and tabs ONLY: CommonMark whitespace. `^\s*` also swallowed NBSP
  // and friends, and then stripped the "marker" after them — but a no-break
  // space is content, and a line it starts is a paragraph.
  const indent = /^[ \t]*/.exec(rest)![0];
  rest = rest.slice(indent.length);

  // Four columns of indentation is INDENTED CODE, where a `#` or a `-` is
  // literal text. Stripping "markers" there destroyed characters CommonMark
  // never considered markup.
  if (isCodeIndent(indent)) {
    return { quote, indent, content: rest };
  }

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
