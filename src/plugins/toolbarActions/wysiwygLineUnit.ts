/**
 * WYSIWYG line-unit resolution.
 *
 * Purpose: answer "which node is the LINE at this cursor?" for the block
 * operations named after lines — deleteLine, duplicateLine, moveLineUp/Down.
 * Source mode implements those against text lines; this is the ProseMirror
 * equivalent, and getting it wrong is how `deleteLine` in a table cell came to
 * delete the entire table.
 *
 * Extracted from `wysiwygAdapterBlockOps.ts` so the question "what is a line"
 * lives apart from the transactions that act on one.
 *
 * @coordinates-with wysiwygAdapterBlockOps.ts — the sole consumer
 * @coordinates-with sourceAdapter.ts — the line-oriented surface this mirrors
 * @module plugins/toolbarActions/wysiwygLineUnit
 */
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
