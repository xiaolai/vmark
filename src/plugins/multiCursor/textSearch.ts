/**
 * Multi-cursor Text Search
 *
 * Purpose: Provides text search and word-boundary helpers used by multi-cursor commands
 * (selectNextOccurrence, selectAllOccurrences). Case-sensitive matching ensures
 * deterministic cursor placement across the document.
 *
 * @coordinates-with commands.ts — uses findAllOccurrences/getWordAtCursor for Cmd+D/Cmd+Shift+L
 * @coordinates-with wordSegmentation.ts — CJK-aware word boundary detection
 * @module plugins/multiCursor/textSearch
 */
import type { EditorState } from "@tiptap/pm/state";
import { findWordBoundaries } from "@/utils/wordSegmentation";

/**
 * Get the text content of a selection range.
 */
export function getSelectionText(state: EditorState): string {
  const { from, to } = state.selection;
  return state.doc.textBetween(from, to);
}

/**
 * Get word at cursor position when selection is empty.
 * Returns the word boundaries in document coordinates.
 */
export function getWordAtCursor(
  state: EditorState
): { from: number; to: number; text: string } | null {
  const { from, to } = state.selection;

  // Only works for cursor (empty selection)
  if (from !== to) return null;

  // Get text content of the paragraph/block containing cursor
  const $pos = state.doc.resolve(from);
  const parent = $pos.parent;
  const parentOffset = $pos.parentOffset;

  const text = parent.textContent;
  const boundaries = findWordBoundaries(text, parentOffset);

  if (!boundaries) return null;

  // Convert to document coordinates
  const blockStart = from - parentOffset;
  return {
    from: blockStart + boundaries.start,
    to: blockStart + boundaries.end,
    text: text.slice(boundaries.start, boundaries.end),
  };
}

/**
 * Find all occurrences of searchText in the document.
 * Returns array of { from, to } positions.
 */
export function findAllOccurrences(
  state: EditorState,
  searchText: string,
  bounds?: { from: number; to: number }
): Array<{ from: number; to: number }> {
  const results: Array<{ from: number; to: number }> = [];

  if (!searchText) return results;
  const rangeFrom = bounds?.from ?? 0;
  const rangeTo = bounds?.to ?? state.doc.content.size;

  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    if (pos > rangeTo || pos + node.nodeSize < rangeFrom) return;

    const text = node.text || "";
    let index = text.indexOf(searchText);

    while (index !== -1) {
      const from = pos + index;
      const to = pos + index + searchText.length;
      if (from >= rangeFrom && to <= rangeTo) {
        results.push({ from, to });
      }
      index = text.indexOf(searchText, index + 1);
    }
  });

  // Sort by position
  results.sort((a, b) => a.from - b.from);

  return results;
}
