/**
 * Purpose: parse ONE line as a fence delimiter, or as a list-item boundary.
 *
 * The delimiter grammar — container prefixes, list markers, marker runs, info
 * strings — with no notion of a range. Pairing delimiters into ranges is
 * `fenceScanner.ts`'s job; splitting them apart is what kept that file under
 * the size limit when the list-boundary rule landed.
 *
 * @coordinates-with plugins/shared/fenceScanner.ts — the pairing half
 * @module plugins/shared/fenceDelimiter
 */

export interface FenceDelimiter {
  marker: "`" | "~";
  run: number;
  info: string;
  /** Blockquote prefix the delimiter sits behind, e.g. `> `. */
  prefix: string;
  /** Spaces between the container prefixes and the marker run. */
  indent: number;
  /** Whether a LIST MARKER introduces this line (`- `, `1. `). */
  startsListItem: boolean;
  /**
   * Characters before the first marker on the line — container prefixes plus
   * the delimiter's own indent.
   *
   * Consumers that report POSITIONS (the language token's bounds, for a
   * rename) need where the run actually starts, not just that it exists. It is
   * returned here so they do not re-derive it with a second parser, which is
   * how this grammar came to be implemented twice.
   */
  markerOffset: number;
}

/** Leading blockquote markers, which a fence may legally sit behind. */
const CONTAINER_PREFIX_RE = /^(?: {0,3}>[ \t]?)*/;

/** Number of `>` markers in a container prefix. */
export function quoteDepth(prefix: string): number {
  return (prefix.match(/>/g) ?? []).length;
}

/**
 * Whether a closer's trailing run is blank.
 *
 * `.trim()` would accept NBSP and other Unicode spaces; CommonMark allows only
 * spaces and tabs after a closing fence.
 */
export function isBlankInfo(info: string): boolean {
  return /^[ \t]*$/.test(info);
}

/**
 * A list-item marker a fence may open on (`- ``` `), or the content indent of
 * such an item on later lines. Missing these meant a list-item fence was never
 * seen at its opener, while its indented CLOSER was misread as a new opener —
 * flipping inside and outside for the rest of the document.
 */
/**
 * A list marker plus its padding — and the padding is BOUNDED at 4.
 *
 * `[ \t]+` consumed unlimited whitespace, so `- -     ``` ` looked like a
 * marker, a marker and a fence. CommonMark reads 5+ spaces after a marker as
 * "content starts one space in, the rest is INDENTED CODE" — there is no fence
 * there at all, and inventing one turned ordinary text into a phantom range.
 */
const LIST_ITEM_PREFIX_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\t| {1,4}(?! ))/;

/**
 * How permissive the delimiter grammar is about leading indentation.
 *
 * `commonmark` caps it at three spaces, per the spec: four is indented code.
 *
 * `deep-indent` accepts any run of spaces. A fence nested two list levels deep
 * carries four or more raw spaces of CONTINUATION indent with no marker on the
 * fence line, so a line-based parser cannot tell it from indented code — and
 * the cursor-context guards would stop engaging inside real fenced code. A
 * four-space run OUTSIDE a list is an indented code block anyway, which is
 * still code, so the guards' semantics hold either way. Over-including is the
 * safe direction for a guard; under-including is not.
 *
 * This is the ONE deliberate grammar difference between the safety boundary
 * and cursor-context detection, and it is a parameter rather than a second
 * parser — which is what let the two drift before.
 */
export type FenceIndentPolicy = "commonmark" | "deep-indent";

/** Parse a line as a fence delimiter, or null. Whitespace is spaces/tabs only. */
export function parseFenceDelimiter(
  line: string,
  indentPolicy: FenceIndentPolicy = "commonmark"
): FenceDelimiter | null {
  // Containers nest in ANY order: `- > ```` is a fence inside a blockquote
  // inside a list item. Stripping one quote run and then one list marker read
  // that as no fence at all, so every cursor guard stayed off inside it.
  let rest = line;
  let quotePrefix = "";
  let consumed = 0;
  let startsListItem = false;
  for (;;) {
    const quote = CONTAINER_PREFIX_RE.exec(rest)?.[0] ?? "";
    const list = LIST_ITEM_PREFIX_RE.exec(rest.slice(quote.length))?.[0] ?? "";
    if (!quote && !list) break;
    quotePrefix += quote;
    if (list) startsListItem = true;
    consumed += quote.length + list.length;
    rest = rest.slice(quote.length + list.length);
  }

  // SPACES only, and at most three under CommonMark: a tab expands to four
  // COLUMNS, which is indented code, not a fence. `[ \t]{0,3}` let a single tab
  // through and a "fence" toggle then deleted literal lines from an indented
  // code block.
  const indent = indentPolicy === "deep-indent" ? "*" : "{0,3}";
  const match = new RegExp(`^( ${indent})([\`~])(\\2*)([^\n]*)$`).exec(rest);
  if (!match) return null;

  const marker = match[2] as "`" | "~";
  const run = match[3].length + 1;
  if (run < 3) return null;

  const info = match[4];
  // CommonMark: a BACKTICK fence's info string may not contain a backtick —
  // otherwise it is not a fence at all. Accepting one invented fences out of
  // ordinary prose and let the toggle "unfence" it destructively.
  if (marker === "`" && info.includes("`")) return null;

  return {
    marker,
    run,
    info,
    prefix: quotePrefix,
    indent: match[1].length,
    startsListItem,
    markerOffset: consumed + match[1].length,
  };
}

/** A fenced code block's line range. */
export function listItemStart(line: string): number | null {
  let rest = line;
  let consumed = 0;
  let found = false;
  for (;;) {
    const quote = CONTAINER_PREFIX_RE.exec(rest)?.[0] ?? "";
    const list = LIST_ITEM_PREFIX_RE.exec(rest.slice(quote.length))?.[0] ?? "";
    if (!quote && !list) break;
    if (list) found = true;
    consumed += quote.length + list.length;
    rest = rest.slice(quote.length + list.length);
  }
  return found ? consumed : null;
}

