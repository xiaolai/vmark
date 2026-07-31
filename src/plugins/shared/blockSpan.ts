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
 *   - A blank line separates PARAGRAPHS, and a fence bounds a code block. That
 *     is not the whole of markdown's block grammar — CommonMark only defines a
 *     paragraph that way, and headings, quotes, thematic breaks and HTML can
 *     start a block with no blank line before them, so `para` + `# heading`
 *     still resolves here as one span. Fences are handled because getting them
 *     wrong was DESTRUCTIVE: a caret below a closing ``` resolved to the whole
 *     code block. The remaining cases are non-destructive over-reach, and the
 *     real fix is the CodeMirror syntax tree rather than more line rules.
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

import { fenceRanges } from "./lineContent";

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
  // Clamping alone produced a valid-LOOKING index into an empty array, and the
  // blank check then called `.trim()` on undefined.
  if (lines.length === 0) return { start: 0, end: 0 };

  const last = lines.length - 1;
  let start = Math.min(Math.max(fromLine, 0), last);
  let end = Math.min(Math.max(toLine, 0), last);
  if (start > end) [start, end] = [end, start];

  // A selection anchored on a blank line has no block to widen to.
  if (start === end && isBlank(lines[start])) return { start, end };

  // A FENCE is a hard boundary in both directions. Blank lines alone do not
  // bound a code block — markdown does not require one after a closing fence —
  // so a caret in the paragraph directly below ``` used to widen straight up
  // through the fence and hand the whole code block to whatever ran next.
  // Wrapping, converting or CJK-formatting that "block" rewrote the user's code.
  const fences = fenceRanges(lines);
  const fenceOf = (i: number) => fences.find((f) => i >= f.open && i <= f.close);

  // Inside a fence the whole fence IS the block, blank lines included. Each
  // endpoint resolves its OWN fence: taking only the first left the second
  // fence's closing delimiter outside the span, so a replacement could leave a
  // half-open fence behind and expose the rest of the file as code.
  const startFence = fenceOf(start);
  const endFence = fenceOf(end);
  if (startFence || endFence) {
    return {
      start: Math.min(start, startFence?.open ?? start),
      end: Math.max(end, endFence?.close ?? end),
    };
  }

  while (start > 0 && !isBlank(lines[start - 1]) && !fenceOf(start - 1)) start -= 1;
  while (end < last && !isBlank(lines[end + 1]) && !fenceOf(end + 1)) end += 1;
  return { start, end };
}

/**
 * The block span touched by a CodeMirror selection, as line NUMBERS (0-based).
 *
 * Exists so the three source-mode callers stop repeating — and stop repeating
 * the same off-by-one. CodeMirror's `to` is EXCLUSIVE, so a selection ending at
 * a line start resolves through `lineAt(to)` to the NEXT line and quietly pulled
 * an untouched block into the operation. A non-empty selection therefore reads
 * its last line from `to - 1`.
 */
export function selectionBlockSpan(
  lines: readonly string[],
  fromOffset: number,
  toOffset: number,
  lineNumberAt: (offset: number) => number,
): BlockSpan {
  const lastOffset = toOffset > fromOffset ? toOffset - 1 : toOffset;
  return sourceBlockSpan(lines, lineNumberAt(fromOffset) - 1, lineNumberAt(lastOffset) - 1);
}
