/**
 * Position Utilities for Source Mode Format Popup
 *
 * Helper functions for getting bounding rects of selections and cursors.
 */

import type { EditorView } from "@codemirror/view";
import { getWordAtCursor } from "./wordSelection";

export type ContextMode = "format" | "inline-insert" | "block-insert";

/**
 * Get the bounding rect for a selection range.
 */
export function getSelectionRect(view: EditorView, from: number, to: number) {
  const fromCoords = view.coordsAtPos(from);
  const toCoords = view.coordsAtPos(to);

  if (!fromCoords || !toCoords) return null;

  return {
    top: Math.min(fromCoords.top, toCoords.top),
    left: Math.min(fromCoords.left, toCoords.left),
    bottom: Math.max(fromCoords.bottom, toCoords.bottom),
    right: Math.max(fromCoords.right, toCoords.right),
  };
}

/**
 * Get the bounding rect for current cursor position.
 */
export function getCursorRect(view: EditorView, pos: number) {
  const coords = view.coordsAtPos(pos);
  if (!coords) return null;

  return {
    top: coords.top,
    left: coords.left,
    bottom: coords.bottom,
    right: coords.right,
  };
}

/**
 * Determine context mode for format popup based on cursor position.
 * - "format": text selected OR cursor in word
 * - "inline-insert": cursor not in word, not at blank line
 * - "block-insert": cursor at beginning of blank line
 */
export function getContextModeSource(view: EditorView): ContextMode {
  const { from, to } = view.state.selection.main;

  // Has selection → format
  if (from !== to) return "format";

  // Check if cursor in word
  const wordRange = getWordAtCursor(view);
  if (wordRange) return "format";

  // Check if at blank line start
  const line = view.state.doc.lineAt(from);
  const atStart = from === line.from;
  const isEmpty = line.text.trim() === "";

  if (atStart && isEmpty) return "block-insert";

  return "inline-insert";
}
