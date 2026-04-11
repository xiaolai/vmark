/**
 * Multi-cursor Enter handling for ProseMirror
 *
 * Splits the parent node at each cursor position. Operates in
 * reverse document order to preserve position validity. Ranges
 * where canSplit returns false are skipped to avoid data loss.
 */
import { SelectionRange } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { canSplit } from "@tiptap/pm/transform";
import { MultiSelection } from "./MultiSelection";
import { sortRangesDescending, normalizeRangesWithPrimary } from "./rangeUtils";

/**
 * Handle Enter at all cursor positions.
 * Splits the parent node at each cursor via `tr.split()`. Selections are
 * deleted before splitting. Ranges where `canSplit` returns false are
 * skipped entirely to avoid data loss.
 *
 * Note: this uses raw `tr.split` — correct for paragraphs and most block
 * nodes but does not replicate list-item or code-block Enter semantics.
 * Modified Enter (Shift, Alt, etc.) is not handled here.
 *
 * @param state - Current editor state
 * @returns Transaction or null if not a MultiSelection
 */
export function handleMultiCursorEnter(
  state: EditorState
): Transaction | null {
  const { selection } = state;

  if (!(selection instanceof MultiSelection)) {
    return null;
  }

  // Pre-merge overlapping ranges so each split targets a disjoint span —
  // without this, overlapping regions would be deleted and split multiple
  // times, producing extra paragraph nodes or lost content.
  const preMerged = normalizeRangesWithPrimary(
    selection.ranges, state.doc, selection.primaryIndex, true
  );
  const sortedRanges = sortRangesDescending(preMerged.ranges);
  let tr = state.tr;

  // Track ranges skipped by canSplit to preserve their selection span
  const skippedFromPositions = new Set<number>();

  // Apply splits from end to start (preserves earlier positions)
  for (const range of sortedRanges) {
    const from = range.$from.pos;
    const to = range.$to.pos;

    // Guard: skip range entirely if position can't be split (avoids data loss)
    if (!canSplit(tr.doc, from)) {
      skippedFromPositions.add(from);
      continue;
    }

    if (from !== to) {
      // Selection — delete first, then split at that position
      tr = tr.delete(from, to);
    }
    tr = tr.split(from);
  }

  // If no splits were applied, let the default Enter handler run
  if (!tr.docChanged) {
    return null;
  }

  // Remap cursors through the changes
  const newRanges = preMerged.ranges.map((range) => {
    if (skippedFromPositions.has(range.$from.pos)) {
      // Preserve original range span for skipped ranges
      const newFrom = tr.mapping.map(range.$from.pos);
      const newTo = tr.mapping.map(range.$to.pos);
      return new SelectionRange(
        tr.doc.resolve(newFrom),
        tr.doc.resolve(newTo)
      );
    }
    // Split was applied — cursor at start of new paragraph (bias 1 = forward)
    const newPos = tr.mapping.map(range.$from.pos, 1);
    const $pos = tr.doc.resolve(newPos);
    return new SelectionRange($pos, $pos);
  });

  const normalized = normalizeRangesWithPrimary(newRanges, tr.doc, preMerged.primaryIndex, true);
  const newSel = new MultiSelection(normalized.ranges, normalized.primaryIndex);
  tr = tr.setSelection(newSel);
  tr = tr.setMeta("addToHistory", true);

  return tr;
}
