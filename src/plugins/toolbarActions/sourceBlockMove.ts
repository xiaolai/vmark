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
 * paragraphs reorder as paragraphs and the separators stay put.
 *
 * The same module also answers two neighbouring questions that need the same
 * structural view: whether a JOIN would fuse two blocks (across a blank line,
 * or two list items into one), and whether a DUPLICATE needs an explicit hard
 * break — a plain paragraph line does, since a bare newline is a soft break and
 * renders as one continued line; a heading, list item or table row does not.
 *
 * These are deliberately NOT changes to the shared `textTransformations`
 * helpers, which other callers use on plain text where the text-editor reading
 * is the right one.
 *
 * @coordinates-with sourceTextTransforms.ts — the handlers that call this
 * @coordinates-with wysiwygLineUnit.ts — the WYSIWYG side of the same question
 * Inside a fenced code block a line is LITERAL TEXT, so `duplicateNeedsHardBreak`
 * declines there — a markdown hard-break backslash is a stray character in the
 * user's source code.
 *
 * @module plugins/toolbarActions/sourceBlockMove
 */

import { enclosingFence, fenceRanges } from "@/plugins/shared/lineContent";

const isBlank = (line: string): boolean => line.trim() === "";

/** Indentation width of a list item line, or null when it is not one. */
function listIndent(line: string): number | null {
  const m = /^(\s*)(?:[-*+]|\d+[.)])\s/.exec(line);
  return m ? m[1].length : null;
}

/** Whether the move would put a nested list item outside its parent. */
function crossesListDepth(lines: readonly string[], selection: Span, neighbourIndex: number): boolean {
  const moving = listIndent(lines[selection.start]);
  const neighbour = listIndent(lines[neighbourIndex]);
  return moving !== null && neighbour !== null && neighbour < moving;
}

interface Span {
  start: number;
  end: number;
}

/** The contiguous run of non-blank lines containing [start, end]. */
function blockAround(lines: readonly string[], start: number, end: number): Span {
  let from = start;
  let to = end;
  while (from > 0 && !isBlank(lines[from - 1])) from -= 1;
  while (to < lines.length - 1 && !isBlank(lines[to + 1])) to += 1;
  return { start: from, end: to };
}

/** Move the given line span up, treating blank lines as block separators. */
export function moveBlockAware(
  lines: readonly string[],
  selection: Span,
  direction: "up" | "down",
): string[] | null {
  const up = direction === "up";
  const neighbourIndex = up ? selection.start - 1 : selection.end + 1;
  if (neighbourIndex < 0 || neighbourIndex >= lines.length) return null;

  // A fence delimiter must not move, and content must not move ACROSS one.
  // Hoisting the first line of ["```","code","```"] gave ["code","```","```"] —
  // the fence destroyed and the rest of the file exposed as code. This action is
  // on the code-block allow-list, so the check has to live here.
  if (crossesFenceBoundary(lines, selection, neighbourIndex)) return null;

  // A nested list item must not swap with a SHALLOWER one: hoisting `  - inner`
  // past `- outer` puts the child above its parent and the nesting is gone.
  // WYSIWYG declines the move for the same reason.
  if (crossesListDepth(lines, selection, neighbourIndex)) return null;

  // Adjacent non-blank line: an ordinary one-line swap, which is what reorders
  // list items and lines inside a paragraph.
  if (!isBlank(lines[neighbourIndex])) {
    const moving = lines.slice(selection.start, selection.end + 1);
    const rest = [...lines];
    rest.splice(selection.start, moving.length);
    rest.splice(up ? selection.start - 1 : selection.start + 1, 0, ...moving);
    return rest;
  }

  // A blank separator: swap whole blocks so the paragraphs reorder intact.
  const block = blockAround(lines, selection.start, selection.end);
  let gap = neighbourIndex;
  while (gap >= 0 && gap < lines.length && isBlank(lines[gap])) gap += up ? -1 : 1;
  if (gap < 0 || gap >= lines.length) return null; // nothing but blanks beyond

  const other = blockAround(lines, gap, gap);
  // The expansion itself can swallow delimiters: inside ["```","a","","b","```"]
  // the blank line put this on the whole-block path, `blockAround` absorbed both
  // delimiters, and the move returned ["b","```","","```","a"] — the fence gone.
  // The immediate-neighbour guard above cannot see that, so re-check the spans.
  if (spanTouchesFence(lines, block) || spanTouchesFence(lines, other)) return null;

  const first = up ? other : block;
  const second = up ? block : other;
  const between = lines.slice(first.end + 1, second.start);

  return [
    ...lines.slice(0, first.start),
    ...lines.slice(second.start, second.end + 1),
    ...between,
    ...lines.slice(first.start, first.end + 1),
    ...lines.slice(second.end + 1),
  ];
}

/** Whether any line of `span` is a fence delimiter. */
function spanTouchesFence(lines: readonly string[], span: Span): boolean {
  const fences = fenceRanges(lines);
  for (let i = span.start; i <= span.end; i += 1) {
    if (fences.some((f) => i === f.open || (f.closed && i === f.close))) return true;
  }
  return false;
}

/**
 * Whether a move would disturb a fence: either endpoint is a delimiter, or the
 * move would carry a line across one.
 */
function crossesFenceBoundary(
  lines: readonly string[],
  selection: Span,
  neighbourIndex: number,
): boolean {
  // Scanned ONCE. Calling `isFenceDelimiter` per line re-parsed the whole
  // document each time, making a large selection quadratic.
  const fences = fenceRanges(lines);
  const isDelimiter = (i: number) => fences.some((f) => i === f.open || (f.closed && i === f.close));
  const fenceOf = (i: number) => fences.find((f) => i >= f.open && i <= f.close);

  for (let i = selection.start; i <= selection.end; i += 1) {
    if (isDelimiter(i)) return true;
  }
  if (isDelimiter(neighbourIndex)) return true;
  // Content may reorder WITHIN one fence, but not step outside it.
  return fenceOf(selection.start)?.open !== fenceOf(neighbourIndex)?.open;
}

/**
 * Whether a join would fuse two separate BLOCKS.
 *
 * Joining across a blank line merges two paragraphs, and joining two list items
 * collapses them into one — `- one` / `- two` becomes `- one - two`. WYSIWYG
 * declines both, because joinBackward has no node to join across.
 *
 * A multi-line selection joins the lines it covers, so the check runs over
 * those; a collapsed cursor joins with the line below it.
 */
export function joinWouldFuseBlocks(
  lines: readonly string[],
  startLine: number,
  endLine: number,
): boolean {
  if (endLine > startLine) {
    for (let i = startLine; i <= endLine; i += 1) {
      if (isBlank(lines[i] ?? "")) return true;
      if (i > startLine && listIndent(lines[i] ?? "") !== null) return true;
    }
    return false;
  }
  const next = lines[startLine + 1];
  if (next === undefined) return true; // nothing below to join with
  if (isBlank(lines[startLine] ?? "") || isBlank(next)) return true;
  return listIndent(next) !== null;
}

/**
 * Whether duplicating `lineIndex` should join the copies with a HARD BREAK.
 *
 * Duplicating a plain paragraph line should leave one paragraph showing two
 * lines, which in markdown needs an explicit break — a bare newline is a SOFT
 * break and renders as a single line, so the two surfaces produced different
 * documents. Structural lines (list items, table rows, headings) duplicate as
 * siblings and need no marker.
 */
export function duplicateNeedsHardBreak(lines: readonly string[], lineIndex: number): boolean {
  // Inside a fence the line is LITERAL TEXT, not markdown. A hard-break
  // backslash appended there is a stray character in the user's source code —
  // `const a = 1;` duplicated became `const a = 1;\` on the first copy.
  if (enclosingFence(lines, lineIndex)) return false;

  const raw = lines[lineIndex] ?? "";
  if (isBlank(raw)) return false;
  // A QUOTED paragraph is still a paragraph, so the quote marker is peeled
  // before deciding — `> text` needs the break just as `text` does.
  const line = raw.replace(/^\s*(?:>\s?)+/, "");
  if (isBlank(line)) return false;
  if (listIndent(line) !== null) return false;
  return !/^\s*(?:#{1,6}\s|\|)/.test(line);
}
