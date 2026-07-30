/**
 * How far a BLOCK-level action reaches.
 *
 * Purpose: the two editing surfaces kept disagreeing about the reach of the same
 * command, and the reason was never that someone chose differently — it was that
 * neither surface CHOSE at all. Each inherited whatever its substrate made
 * convenient: ProseMirror naturally addresses the enclosing node, CodeMirror
 * naturally addresses the selected characters. So "Insert Note" wrapped a
 * paragraph in one mode and a five-character selection in the other, and neither
 * behaviour was written down anywhere.
 *
 * This module writes it down. A block-level action operates on the WHOLE
 * TOP-LEVEL BLOCKS the selection touches — never on a fragment of one, never on
 * a single item of a structure.
 *
 * Key decisions:
 *   - A blank line separates blocks. That is markdown's own rule, so a paragraph
 *     is the contiguous run of non-blank lines around the cursor.
 *   - A list is ONE block, items included. Wrapping a single item shatters the
 *     list into three structures — list, wrapped item, list — which is the exact
 *     defect already recorded for blockquote in the parity ledger. The same
 *     reasoning applies to every wrapper, so it lives here rather than in each.
 *   - Indices are clamped, not validated. Callers derive them from selections
 *     that can legally sit at the document edge.
 *
 * @coordinates-with toolbarActions/sourceInsertActions.ts — alert/details/math/diagram
 * @coordinates-with toolbarActions/__tests__/parity — the gate that forced this
 * @module plugins/shared/blockSpan
 */

/** Inclusive line range, 0-based. */
export interface BlockSpan {
  start: number;
  end: number;
}

const isBlank = (line: string): boolean => line.trim() === "";

/**
 * The whole top-level blocks spanned by lines `[fromLine, toLine]`.
 *
 * A blank line bounds the span; a selection sitting ON a blank line yields just
 * that line, since there is no block to widen to.
 */
export function sourceBlockSpan(lines: readonly string[], fromLine: number, toLine: number): BlockSpan {
  const last = Math.max(0, lines.length - 1);
  let start = Math.min(Math.max(fromLine, 0), last);
  let end = Math.min(Math.max(toLine, 0), last);
  if (start > end) [start, end] = [end, start];

  // A selection anchored on a blank line has no block to widen to.
  if (isBlank(lines[start] ?? "") && start === end) return { start, end };

  while (start > 0 && !isBlank(lines[start - 1] ?? "")) start -= 1;
  while (end < last && !isBlank(lines[end + 1] ?? "")) end += 1;
  return { start, end };
}
