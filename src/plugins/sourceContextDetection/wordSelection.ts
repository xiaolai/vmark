/**
 * Word Selection Utility
 *
 * Detects words at cursor position using the shared word segmentation utility.
 * Matches browser-native word selection behavior (double-click).
 */

import type { EditorView } from "@codemirror/view";
import { findWordBoundaries } from "@/utils/wordSegmentation";

/**
 * Get word range at cursor position using shared word segmentation.
 * Uses Intl.Segmenter for CJK support, with regex fallback.
 * Returns null if cursor is in whitespace/punctuation.
 */
export function getWordAtCursor(
  view: EditorView
): { from: number; to: number } | null {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const posInLine = from - line.from;

  // Use shared word segmentation utility
  const result = findWordBoundaries(line.text, posInLine);
  if (!result) return null;

  return {
    from: line.from + result.start,
    to: line.from + result.end,
  };
}

/**
 * Select word at cursor position.
 * Dispatches selection change to editor and returns the new range.
 * Returns null if no word was found.
 */
export function selectWordAtCursor(
  view: EditorView
): { from: number; to: number } | null {
  const range = getWordAtCursor(view);
  if (!range) return null;

  view.dispatch({
    selection: { anchor: range.from, head: range.to },
  });

  return range;
}
