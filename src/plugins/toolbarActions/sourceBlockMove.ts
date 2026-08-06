/**
 * Structure-aware line operations for source mode.
 *
 * Purpose: decide what "move this line" moves when blank lines are in play.
 *
 * The generic `moveLinesUp`/`moveLinesDown` utilities swap a line with whatever
 * line is adjacent — including a BLANK one. In a text editor that is correct; in
 * markdown a blank line is a block separator, so swapping across one merges two
 * paragraphs into one and leaves a doubled blank behind. `First` / blank /
 * `Second` became `First` + `Second` on consecutive lines, which is a structural
 * change, not a reordering.
 *
 * The rule here matches what WYSIWYG does without breaking the case that already
 * agreed: WITHIN a block (no blank between) lines swap individually, so list
 * items reorder one at a time; ACROSS a blank separator whole blocks swap, so
 * paragraphs reorder as paragraphs and the separators stay put. A LIST ITEM is
 * one unit, continuation lines and nested children included — moving `- parent`
 * without `  continuation` left the continuation before its owner, exactly the
 * corruption WYSIWYG cannot produce because its list item is one node.
 *
 * The single-line classification questions (join fusing, duplicate hard
 * breaks) live in `sourceLineClassifier.ts`.
 *
 * Key decisions:
 *   - `moveBlockAware` returns the moved lines AND where the selection landed.
 *     The caller used to find its selection again with `indexOf(movedText)`,
 *     which warped to the FIRST identical text in the document.
 *   - A blank-only selection refuses to move: a separator has no block
 *     identity, and swapping it with a neighbour fuses two paragraphs.
 *   - `fenceRanges` is computed ONCE per move and threaded through every check;
 *     each check rescanning the document made large moves quadratic.
 *
 * @coordinates-with sourceTextTransforms.ts — the handlers that call this
 * @coordinates-with sourceLineClassifier.ts — the shared line classification
 * @coordinates-with wysiwygLineUnit.ts — the WYSIWYG side of the same question
 * @module plugins/toolbarActions/sourceBlockMove
 */

import { fenceRanges, isDelimiterLine } from "@/plugins/shared/fenceScanner";
import { isBlank, listIndent } from "./sourceLineClassifier";

type FenceRange = ReturnType<typeof fenceRanges>[number];

const leadingWhitespace = (line: string): number => /^[ \t]*/.exec(line)![0].length;

/** Whether the move would put a nested list item outside its parent. */
function crossesListDepth(lines: readonly string[], selection: Span, partnerStart: number): boolean {
  const moving = listIndent(lines[selection.start]);
  const neighbour = listIndent(lines[partnerStart]);
  return moving !== null && neighbour !== null && neighbour < moving;
}

interface Span {
  start: number;
  end: number;
}

/** What a move produced: the new document lines and the selection's new home. */
export interface BlockMoveResult {
  lines: string[];
  /** New line index of the first ORIGINALLY selected line. */
  selectionStart: number;
}

/** The contiguous run of non-blank lines containing [start, end]. */
function blockAround(lines: readonly string[], start: number, end: number): Span {
  let from = start;
  let to = end;
  while (from > 0 && !isBlank(lines[from - 1])) from -= 1;
  while (to < lines.length - 1 && !isBlank(lines[to + 1])) to += 1;
  return { start: from, end: to };
}

/**
 * Full span of the list item whose MARKER line is `i`: the marker plus its
 * continuation lines and nested children (deeper-indented, non-blank).
 */
function listItemSpanFrom(lines: readonly string[], i: number): Span {
  const indent = listIndent(lines[i]);
  if (indent === null) return { start: i, end: i };
  let end = i;
  while (end + 1 < lines.length) {
    const next = lines[end + 1];
    if (isBlank(next)) break;
    const nextMarker = listIndent(next);
    // A sibling or shallower marker starts the NEXT item.
    if (nextMarker !== null && nextMarker <= indent) break;
    // A dedented non-list line has left the item.
    if (nextMarker === null && leadingWhitespace(next) <= indent) break;
    end += 1;
  }
  return { start: i, end };
}

/** Span of the complete list item CONTAINING line `i`, or `{i,i}` outside one. */
function listItemSpanAround(lines: readonly string[], i: number): Span {
  let m = i;
  while (m > 0 && listIndent(lines[m]) === null && !isBlank(lines[m]) && !isBlank(lines[m - 1])) {
    m -= 1;
  }
  if (listIndent(lines[m]) === null) return { start: i, end: i };
  const span = listItemSpanFrom(lines, m);
  return span.end >= i ? span : { start: i, end: i };
}

/** Move the given line span up or down, treating blank lines as block separators. */
export function moveBlockAware(
  lines: readonly string[],
  selection: Span,
  direction: "up" | "down",
): BlockMoveResult | null {
  const up = direction === "up";

  // A blank separator has no block identity — swapping it with a paragraph
  // fuses that paragraph with its neighbour.
  let allBlank = true;
  for (let i = selection.start; i <= selection.end; i += 1) {
    if (!isBlank(lines[i] ?? "")) {
      allBlank = false;
      break;
    }
  }
  if (allBlank) return null;

  // Scanned ONCE and threaded through every check below; each check rescanning
  // the document made a large move quadratic.
  const fences = fenceRanges(lines);

  // A list item is one unit: marker, continuations, children. Expanding the
  // span is what keeps `  continuation` behind its `- parent`.
  let span: Span = { ...selection };
  if (listIndent(lines[span.start] ?? "") !== null) {
    const endSpan = listItemSpanAround(lines, span.end);
    span = { start: span.start, end: Math.max(span.end, endSpan.end) };
  }

  const neighbourIndex = up ? span.start - 1 : span.end + 1;
  if (neighbourIndex < 0 || neighbourIndex >= lines.length) return null;

  // A fence delimiter must not move, and content must not move ACROSS one.
  // Hoisting the first line of ["```","code","```"] gave ["code","```","```"] —
  // the fence destroyed and the rest of the file exposed as code. This action is
  // on the code-block allow-list, so the check has to live here.
  if (crossesFenceBoundary(fences, span, neighbourIndex)) return null;

  // Adjacent non-blank line: swap with the neighbour's complete unit — its
  // whole list item when it has one, otherwise the single line.
  if (!isBlank(lines[neighbourIndex])) {
    const partner = up
      ? listItemSpanAround(lines, neighbourIndex)
      : listIndent(lines[neighbourIndex]) !== null
        ? listItemSpanFrom(lines, neighbourIndex)
        : { start: neighbourIndex, end: neighbourIndex };

    // A nested list item must not swap with a SHALLOWER one: hoisting `  - inner`
    // past `- outer` puts the child above its parent and the nesting is gone.
    // WYSIWYG declines the move for the same reason.
    if (crossesListDepth(lines, span, partner.start)) return null;

    const moved = [...lines];
    const movingLines = lines.slice(span.start, span.end + 1);
    const partnerLines = lines.slice(partner.start, partner.end + 1);
    const offsetInSpan = selection.start - span.start;

    if (up) {
      moved.splice(partner.start, partnerLines.length + movingLines.length, ...movingLines, ...partnerLines);
      return { lines: moved, selectionStart: partner.start + offsetInSpan };
    }
    moved.splice(span.start, movingLines.length + partnerLines.length, ...partnerLines, ...movingLines);
    return { lines: moved, selectionStart: span.start + partnerLines.length + offsetInSpan };
  }

  // A blank separator: swap whole blocks so the paragraphs reorder intact.
  const block = blockAround(lines, span.start, span.end);
  let gap = neighbourIndex;
  while (gap >= 0 && gap < lines.length && isBlank(lines[gap])) gap += up ? -1 : 1;
  if (gap < 0 || gap >= lines.length) return null; // nothing but blanks beyond

  const other = blockAround(lines, gap, gap);
  // The expansion itself can swallow delimiters: inside ["```","a","","b","```"]
  // the blank line put this on the whole-block path, `blockAround` absorbed both
  // delimiters, and the move returned ["b","```","","```","a"] — the fence gone.
  // The immediate-neighbour guard above cannot see that, so re-check the spans.
  if (spanTouchesFence(fences, block) || spanTouchesFence(fences, other)) return null;

  const first = up ? other : block;
  const second = up ? block : other;
  const between = lines.slice(first.end + 1, second.start);

  const result = [
    ...lines.slice(0, first.start),
    ...lines.slice(second.start, second.end + 1),
    ...between,
    ...lines.slice(first.start, first.end + 1),
    ...lines.slice(second.end + 1),
  ];

  const offsetInBlock = selection.start - block.start;
  const newBlockStart = up
    ? other.start
    : block.start + (other.end - other.start + 1) + (other.start - block.end - 1);
  return { lines: result, selectionStart: newBlockStart + offsetInBlock };
}

/** Whether any line of `span` is a fence delimiter. */
function spanTouchesFence(fences: readonly FenceRange[], span: Span): boolean {
  for (let i = span.start; i <= span.end; i += 1) {
    if (isDelimiterLine(fences, i)) return true;
  }
  return false;
}

/**
 * Whether a move would disturb a fence: either endpoint is a delimiter, or the
 * move would carry a line across one.
 */
function crossesFenceBoundary(
  fences: readonly FenceRange[],
  selection: Span,
  neighbourIndex: number,
): boolean {
  const fenceOf = (i: number) => fences.find((f) => i >= f.open && i <= f.close);

  for (let i = selection.start; i <= selection.end; i += 1) {
    if (isDelimiterLine(fences, i)) return true;
  }
  if (isDelimiterLine(fences, neighbourIndex)) return true;
  // Content may reorder WITHIN one fence, but not step outside it.
  return fenceOf(selection.start)?.open !== fenceOf(neighbourIndex)?.open;
}
