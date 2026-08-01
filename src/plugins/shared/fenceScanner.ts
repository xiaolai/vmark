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
 * The closing-fence indent rule is ABSOLUTE under `commonmark` (0-3 columns
 * from the container's content column) and RELATIVE under `deep-indent`, whose
 * input already has container prefixes stripped.
 *
 * Delimiter PARSING lives in `fenceDelimiter.ts`; this file pairs delimiters
 * into ranges. A list item boundary ends the previous item's fence, so two
 * consecutive item-opened fences yield a range each rather than one run-on.
 *
 * @coordinates-with plugins/shared/fenceDelimiter.ts — the parsing half
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
import {
  type FenceDelimiter,
  type FenceIndentPolicy,
  quoteDepth,
  isBlankInfo,
  parseFenceDelimiter,
  listItemStart,
} from "./fenceDelimiter";

export type { FenceIndentPolicy };
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
/**
 * The indent of a line that STARTS a new list item, or null.
 *
 * A list item boundary ends the previous item's block whether or not the line
 * happens to carry a fence, so this runs the same prefix walk as
 * `parseFenceDelimiter` without requiring a fence marker to follow.
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
    // A new LIST ITEM at the opener's level or shallower ends the previous
    // item's block, fence and all. `!startsListItem` (below) correctly stops
    // the second item's ``` from CLOSING the first — it opens its own — but
    // nothing then ENDED the first, so a single unclosed range swallowed both
    // items and every line after them. A NESTED item (deeper indent) is inside
    // the fence and ends nothing.
    const itemStart = opener?.startsListItem ? listItemStart(lines[i] ?? "") : null;
    if (opener && itemStart !== null && itemStart <= opener.markerOffset) {
      ranges.push({
        open,
        close: i - 1,
        closed: false,
        info: opener.info,
        markerOffset: opener.markerOffset,
        run: opener.run,
      });
      // The boundary line may itself OPEN a fence (`- \`\`\``) or be ordinary
      // item text. Only the former starts a new range; assigning a null
      // `delimiter` to `opener` left a range open that nothing could ever
      // close or flush, silently dropping every fence after it.
      open = delimiter ? i : -1;
      opener = delimiter;
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
      // Indent must be COMPATIBLE, and the rule is ABSOLUTE, not relative.
      //
      // `Math.abs(delimiter.indent - opener.indent) <= 3` looked like
      // CommonMark's 0-3 tolerance but measured the wrong thing: an opener at
      // indent 1 with a closer at indent 4 differs by 3 and closed here, while
      // CommonMark reads that closer as indented code and leaves the fence
      // OPEN. Closing early is the dangerous direction — the rest of the code
      // block loses every guard. CommonMark §119: a closing fence "may be
      // indented up to three spaces", measured from the container's content
      // column, which is what `indent` already is once the prefix is consumed.
      //
      // Under `deep-indent` the extra indentation stands in for a container the
      // line-based scanner cannot see, so it keeps the relative window.
      (indentPolicy === "commonmark"
        ? delimiter.indent <= 3
        : Math.abs(delimiter.indent - opener.indent) <= 3) &&
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
