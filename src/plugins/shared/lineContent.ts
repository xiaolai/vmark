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

/** Split a markdown line into its quote wrapper, indentation, and text. */
export function stripBlockMarkup(line: string): LineContent {
  let rest = line;

  // `trim`, not `trimEnd`: the 0-3 spaces CommonMark allows before a `>` are
  // insignificant, and carrying them into the marker made a re-emitted quote
  // line start with stray indentation.
  const quoteMatch = QUOTE_RE.exec(rest);
  const quote = quoteMatch ? `${quoteMatch[0].trim()} ` : "";
  if (quoteMatch) rest = rest.slice(quoteMatch[0].length);

  // `^\s*` matches every string, so this never returns null.
  const indent = /^\s*/.exec(rest)![0];
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

/**
 * A fence delimiter, with the details CommonMark needs to pair it.
 *
 * `run` matters: a closer must be at LEAST as long as its opener. Comparing only
 * the marker character treated ```` ```` ```` + ``` ``` ``` as a closed block, so
 * everything after it was classified as ordinary markdown and lost its
 * protection — a real bypass of the safety boundary.
 */
interface FenceDelimiter {
  marker: "`" | "~";
  run: number;
  info: string;
  /** Blockquote prefix the delimiter sits behind, e.g. `> `. */
  prefix: string;
}

/** Leading blockquote markers, which a fence may legally sit behind. */
const CONTAINER_PREFIX_RE = /^(?: {0,3}>[ \t]?)*/;

/** Number of `>` markers in a container prefix. */
function quoteDepth(prefix: string): number {
  return (prefix.match(/>/g) ?? []).length;
}

/**
 * Whether a closer's trailing run is blank.
 *
 * `.trim()` would accept NBSP and other Unicode spaces; CommonMark allows only
 * spaces and tabs after a closing fence.
 */
function isBlankInfo(info: string): boolean {
  return /^[ \t]*$/.test(info);
}

/** Parse a line as a fence delimiter, or null. Whitespace is spaces/tabs only. */
function parseFenceDelimiter(line: string): FenceDelimiter | null {
  const prefix = CONTAINER_PREFIX_RE.exec(line)?.[0] ?? "";
  const rest = line.slice(prefix.length);
  const match = /^[ \t]{0,3}([`~])(\1*)([^\n]*)$/.exec(rest);
  if (!match) return null;

  const marker = match[1] as "`" | "~";
  const run = match[2].length + 1;
  if (run < 3) return null;

  const info = match[3];
  // CommonMark: a BACKTICK fence's info string may not contain a backtick —
  // otherwise it is not a fence at all. Accepting one invented fences out of
  // ordinary prose and let the toggle "unfence" it destructively.
  if (marker === "`" && info.includes("`")) return null;

  return { marker, run, info, prefix };
}

/** A fenced code block's line range. */
export interface EnclosingFence {
  /** 0-based line index of the opening delimiter. */
  open: number;
  /** 0-based line index of the closing delimiter, or the last line if unclosed. */
  close: number;
  /** Whether a closing delimiter was actually present. */
  closed: boolean;
}

/** The fence enclosing `lineIndex`, or null when that line is not inside one. */
export function enclosingFence(lines: readonly string[], lineIndex: number): EnclosingFence | null {
  return fenceRanges(lines).find((f) => lineIndex >= f.open && lineIndex <= f.close) ?? null;
}

/** Whether `lineIndex` is a fence DELIMITER line rather than fenced content. */
export function isFenceDelimiter(lines: readonly string[], lineIndex: number): boolean {
  const fence = enclosingFence(lines, lineIndex);
  if (!fence) return false;
  return lineIndex === fence.open || (fence.closed && lineIndex === fence.close);
}

/**
 * Every fenced code block in the document, in order.
 *
 * This is the scanner the SAFETY BOUNDARY resolves through: "am I in a fence"
 * cannot be answered locally, because delimiters pair in document order and a
 * run of backticks above the cursor may itself be a closer.
 *
 * It is NOT yet the only fence parser in the codebase —
 * `sourceContextDetection/codeFenceDetection.ts` and
 * `toolbarActions/multiSelectionContext.ts` each carry their own, and they
 * disagree with this one about run lengths, tildes, info strings and container
 * prefixes. Consolidating them is tracked in the source-block-model plan; until
 * then, treat a disagreement between them as a bug in the other two.
 */
export function fenceRanges(lines: readonly string[]): EnclosingFence[] {
  const ranges: EnclosingFence[] = [];
  let open = -1;
  let opener: FenceDelimiter | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const delimiter = parseFenceDelimiter(lines[i] ?? "");
    if (open === -1) {
      if (delimiter) {
        open = i;
        opener = delimiter;
      }
      continue;
    }
    // A closer matches the opener's CHARACTER, is at least as LONG, and carries
    // no info string. Any of the three getting dropped leaves real code outside
    // the fence and unprotected.
    if (
      delimiter &&
      opener &&
      delimiter.marker === opener.marker &&
      delimiter.run >= opener.run &&
      // Same CONTAINER: a fence opened inside a blockquote is not closed by a
      // delimiter outside it. Capturing the prefix and then ignoring it paired
      // `> \`\`\`` with a bare \`\`\`, so the real fenced code after it was
      // classified as ordinary markdown and lost its protection.
      quoteDepth(delimiter.prefix) === quoteDepth(opener.prefix) &&
      isBlankInfo(delimiter.info)
    ) {
      ranges.push({ open, close: i, closed: true });
      open = -1;
      opener = null;
    }
  }

  // An unclosed fence runs to the end of the document.
  if (open !== -1) ranges.push({ open, close: lines.length - 1, closed: false });
  return ranges;
}
