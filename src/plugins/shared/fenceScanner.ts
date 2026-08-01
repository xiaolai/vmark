/**
 * Purpose: THE fence grammar — the one parser for "is this line a fence
 * delimiter" and "which fenced block encloses this line".
 *
 * Split from `lineContent.ts`, which also strips block markup; the two answer
 * unrelated questions and the file crossed 300 lines once this became the sole
 * fence implementation.
 *
 * This is the SAFETY BOUNDARY's scanner. "Am I in a fence" cannot be answered
 * locally: delimiters pair in document order, a run of backticks above the
 * cursor may itself be a closer, and a fence opened inside a blockquote is not
 * closed by a delimiter outside it.
 *
 * It is also the ONLY implementation. `multiSelectionContext` and
 * `codeFenceDetection` both resolve through it — detection used to keep its
 * own traversal "because its consumers need positional info", and that second
 * grammar had no container prefixes, so a fence inside a blockquote or list
 * item was invisible to the cursor-context guards. Its two genuine needs are
 * PARAMETERS now: `FenceIndentPolicy`, and the opener `info`/`markerOffset`
 * carried on each range.
 *
 * @coordinates-with sourceContextDetection/codeFenceDetection.ts — positions
 * @coordinates-with sourceContextDetection/__tests__/fenceGrammarAgreement.test.ts
 * @module plugins/shared/fenceScanner
 */

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

/**
 * A list-item marker a fence may open on (`- ``` `), or the content indent of
 * such an item on later lines. Missing these meant a list-item fence was never
 * seen at its opener, while its indented CLOSER was misread as a new opener —
 * flipping inside and outside for the rest of the document.
 */
const LIST_ITEM_PREFIX_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/;

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
function parseFenceDelimiter(
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
export interface EnclosingFence {
  /** 0-based line index of the opening delimiter. */
  open: number;
  /** 0-based line index of the closing delimiter, or the last line if unclosed. */
  close: number;
  /** Whether a closing delimiter was actually present. */
  closed: boolean;
  /**
   * The opener's info string, and where its run begins in the opener line.
   *
   * Carried so a consumer that needs POSITIONS — the language token's bounds,
   * for a rename — does not have to re-derive them. Re-deriving the run with
   * `search(/[^\`~]/)` returned -1 for an opener with no info string, and the
   * language position then pointed at the FIRST BACKTICK instead of after the
   * run: setting a language would have written `js\`\`\`` rather than
   * `\`\`\`js`. The scanner already knows the run; it says so.
   */
  info: string;
  markerOffset: number;
  /** Length of the opener's delimiter run (3+). */
  run: number;
}

/** The fence enclosing `lineIndex`, or null when that line is not inside one. */
export function enclosingFence(lines: readonly string[], lineIndex: number): EnclosingFence | null {
  return fenceRanges(lines).find((f) => lineIndex >= f.open && lineIndex <= f.close) ?? null;
}

/**
 * Whether `lineIndex` is a fence DELIMITER line within precomputed `ranges`.
 *
 * Takes the ranges rather than the lines: every caller already holds a
 * `fenceRanges` result, and the old lines-taking variant re-scanned the whole
 * document per call — so callers had each inlined this predicate instead,
 * three copies that could drift.
 */
export function isDelimiterLine(ranges: readonly EnclosingFence[], lineIndex: number): boolean {
  return ranges.some((f) => lineIndex === f.open || (f.closed && lineIndex === f.close));
}

/**
 * Every fenced code block in the document, in order.
 *
 * This is the scanner the SAFETY BOUNDARY resolves through: "am I in a fence"
 * cannot be answered locally, because delimiters pair in document order and a
 * run of backticks above the cursor may itself be a closer.
 *
 * This is the AUTHORITY on the fence grammar, and now the only implementation
 * of it: `multiSelectionContext` and `codeFenceDetection` both resolve through
 * it. Detection's needs are met by parameters rather than a second parser —
 * `indentPolicy` for the list-continuation case, and the opener's `info` and
 * `markerOffset` for the positions its consumers report. Two parsers is how
 * the grammars drifted; there is one now.
 */
export function fenceRanges(
  lines: readonly string[],
  indentPolicy: FenceIndentPolicy = "commonmark"
): EnclosingFence[] {
  const ranges: EnclosingFence[] = [];
  let open = -1;
  let opener: FenceDelimiter | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const delimiter = parseFenceDelimiter(lines[i] ?? "", indentPolicy);
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
      // A line carrying a LIST MARKER starts a new item; it cannot close the
      // previous item's fence. Without this, two consecutive list items each
      // opening a fence paired with EACH OTHER, so the second item's code was
      // classified as prose and lost every guard.
      !delimiter.startsListItem &&
      // Indent must be COMPATIBLE. Under `deep-indent` the extra indentation
      // stands in for a container the line-based parser cannot see, so it has
      // to constrain pairing the way `quoteDepth` does — otherwise an
      // unindented opener was closed by a four-space line that is really
      // indented code, ending the fence early and leaving the rest of the
      // block unprotected. CommonMark's own 0-3 tolerance is the window.
      Math.abs(delimiter.indent - opener.indent) <= 3 &&
      // Same CONTAINER: a fence opened inside a blockquote is not closed by a
      // delimiter outside it. Capturing the prefix and then ignoring it paired
      // `> \`\`\`` with a bare \`\`\`, so the real fenced code after it was
      // classified as ordinary markdown and lost its protection.
      quoteDepth(delimiter.prefix) === quoteDepth(opener.prefix) &&
      isBlankInfo(delimiter.info)
    ) {
      ranges.push({
        open,
        close: i,
        closed: true,
        info: opener.info,
        markerOffset: opener.markerOffset,
        run: opener.run,
      });
      open = -1;
      opener = null;
    }
  }

  // An unclosed fence runs to the end of the document.
  if (open !== -1 && opener) {
    ranges.push({
      open,
      close: lines.length - 1,
      closed: false,
      info: opener.info,
      markerOffset: opener.markerOffset,
      run: opener.run,
    });
  }
  return ranges;
}
