/**
 * WYSIWYG line-unit resolution.
 *
 * Purpose: answer "which node is the LINE at this cursor?" for the block
 * operations named after lines — deleteLine, duplicateLine, moveLineUp/Down.
 * Source mode implements those against text lines; this is the ProseMirror
 * equivalent, and getting it wrong is how `deleteLine` in a table cell came to
 * delete the entire table. A textblock holding hardBreak nodes is SEVERAL
 * lines, so `textblockLineAt` resolves the segment between delimiters first.
 *
 * Extracted from `wysiwygAdapterBlockOps.ts` so the question "what is a line"
 * lives apart from the transactions that act on one.
 *
 * @coordinates-with wysiwygAdapterBlockOps.ts — the sole consumer
 * @coordinates-with sourceAdapter.ts — the line-oriented surface this mirrors
 * @module plugins/toolbarActions/wysiwygLineUnit
 */
import { Fragment } from "@tiptap/pm/model";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";

/**
 * Node types that wrap content WITHOUT starting a new markdown line, so the
 * line is the wrapper rather than the textblock inside it.
 *
 * A `tableCell` serializes inside its row's single line, and a `tableRow` is
 * exactly one line.
 */
const TABLE_WRAPPERS = new Set(["tableCell", "tableHeader", "tableRow"]);

/**
 * Depth of the node representing ONE markdown line at `$from`.
 *
 * The block operations used to hardcode depth 1 — the top-level block — which
 * is the same thing only when that block occupies a single line. Anywhere else
 * it silently operated on the whole container: deleting one row of a table
 * deleted the ENTIRE TABLE, and likewise for a list or a blockquote. The
 * behavioral parity harness measured 25 of 25 line-operation cases diverging
 * from Source across multi-line structures.
 *
 * The line unit is the innermost textblock, climbed outward through wrappers
 * that share its line — so a paragraph in a table cell resolves to its ROW, and
 * a paragraph in a single-block list item resolves to the ITEM. A list item
 * holding a paragraph AND a nested list spans several lines, so the climb stops
 * there and the paragraph itself is the line.
 *
 * Returns 0 when no textblock contains the position (e.g. a NodeSelection on an
 * atom), which callers treat as "no line here".
 */
export function lineUnitDepth($from: ResolvedPos): number {
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) depth -= 1;
  if (depth === 0) return 0;

  while (depth > 1) {
    const parent = $from.node(depth - 1);
    const name = parent.type.name;
    if (TABLE_WRAPPERS.has(name)) {
      depth -= 1;
      continue;
    }
    // A single-block list item IS the line; a multi-block one is not.
    if (name === "listItem" && parent.childCount === 1) {
      depth -= 1;
      continue;
    }
    break;
  }
  return depth;
}

/** Doc-coordinate range of some inline content within a textblock. */
export interface LineRange {
  from: number;
  to: number;
}

/** One visual line of a hard-break textblock, with its neighbours. */
export interface TextblockLine extends LineRange {
  /** The line above/below within the same block, when a hard break makes one. */
  prev: LineRange | null;
  next: LineRange | null;
}

/**
 * Resolve the visual LINE at the cursor within its textblock.
 *
 * A textblock equals one markdown line only until it contains a hardBreak —
 * then it serializes as several lines, and operating on the node would
 * move/delete/duplicate all of them at once. Returns the content range
 * delimited by the hard breaks bracketing the cursor (delimiters excluded),
 * or null when the block holds no hard break and the whole block is the line.
 */
export function textblockLineAt($from: ResolvedPos): TextblockLine | null {
  const parent = $from.parent;
  if (!parent.isTextblock) return null;

  // Parent offsets of each hardBreak delimiter.
  const breaks: number[] = [];
  parent.forEach((child, offset) => {
    if (child.type.name === "hardBreak") breaks.push(offset);
  });
  if (breaks.length === 0) return null;

  const blockStart = $from.start();
  const starts = [0, ...breaks.map((b) => b + 1)];
  const ends = [...breaks, parent.content.size];

  // A cursor sitting exactly on a delimiter belongs to the line it ends.
  const cursor = $from.parentOffset;
  let index = 0;
  while (index < ends.length - 1 && cursor > ends[index]) index += 1;

  const seg = (i: number): LineRange => ({ from: blockStart + starts[i], to: blockStart + ends[i] });
  return {
    ...seg(index),
    prev: index > 0 ? seg(index - 1) : null,
    next: index < ends.length - 1 ? seg(index + 1) : null,
  };
}

/** The inline content of `range` within the cursor's textblock. */
export function cutLineRange($from: ResolvedPos, range: LineRange): Fragment {
  const blockStart = $from.start();
  return $from.parent.cut(range.from - blockStart, range.to - blockStart).content;
}

/**
 * The deletion range for one line of a hard-break textblock: the line plus
 * exactly one delimiter — the break before it, or for the first line the one
 * after — so the remaining lines keep single breaks between them.
 */
export function lineDeletionRange(line: TextblockLine): LineRange {
  return line.prev ? { from: line.prev.to, to: line.to } : { from: line.from, to: line.to + 1 };
}

/** An intra-block line swap, ready to apply with `tr.replaceWith`. */
export interface LineSwap {
  from: number;
  to: number;
  fragment: Fragment;
  /** Where the cursor lands to keep its offset within the moved line. */
  cursorPos: number;
}

/**
 * Compute the replacement that swaps the cursor's line with its neighbour in
 * `direction`, around the delimiter between them (reused, so its marks
 * survive). Returns null at the block's edge — no neighbouring line there.
 */
export function swapTextblockLines(
  $from: ResolvedPos,
  line: TextblockLine,
  direction: "up" | "down"
): LineSwap | null {
  const other = direction === "up" ? line.prev : line.next;
  if (!other) return null;

  const upper = direction === "up" ? other : line;
  const lower = direction === "up" ? line : other;
  const delimiter = $from.doc.nodeAt(upper.to);
  /* v8 ignore next -- @preserve defensive: a hardBreak always sits between two segments */
  if (!delimiter) return null;

  const movedStart = direction === "up" ? upper.from : upper.from + (lower.to - lower.from) + 1;
  return {
    from: upper.from,
    to: lower.to,
    fragment: cutLineRange($from, lower)
      .append(Fragment.from(delimiter))
      .append(cutLineRange($from, upper)),
    cursorPos: movedStart + ($from.pos - line.from),
  };
}

/**
 * Whether `$pos` sits anywhere inside a table's structure.
 *
 * Blank-line removal must leave tables alone: an empty paragraph in a cell is
 * an empty CELL, not a blank markdown line — Source mode never sees one — and
 * widening a deletion there would take the cell or the row out with it.
 */
export function withinTable($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    if (TABLE_WRAPPERS.has($pos.node(d).type.name)) return true;
  }
  return false;
}

/**
 * Whether the row at `targetIndex` of a table is its header row.
 *
 * Reordering rows must not move a body row above the header: markdown puts the
 * delimiter (`| --- |`) immediately after the header, so a swap emits a table
 * whose header is data and whose delimiter sits mid-body — it stops parsing as
 * a table at all. Source mode has exactly this defect (it treats rows as plain
 * lines); WYSIWYG used to avoid it only by accident, because it moved the whole
 * table rather than a row, and must now refuse the move explicitly.
 */
export function isTableHeaderRow(parent: PMNode, targetIndex: number): boolean {
  if (parent.type.name !== "table") return false;
  if (targetIndex < 0 || targetIndex >= parent.childCount) return false;
  const row = parent.child(targetIndex);
  return row.type.name === "tableRow" && row.firstChild?.type.name === "tableHeader";
}

/**
 * Widen a deletion outward while the node being removed is its parent's ONLY
 * child, so no empty husk is left behind.
 *
 * Deleting the sole item of a list otherwise leaves an empty list, which
 * serializes to a bare `-`; deleting the sole paragraph of a blockquote leaves
 * a bare `>`. Source mode deletes the line and the structure with it, so this
 * is also what parity requires.
 */
export function collapseEmptyAncestors($from: ResolvedPos, depth: number): number {
  let d = depth;
  while (d > 1 && $from.node(d - 1).childCount === 1) d -= 1;
  return d;
}
