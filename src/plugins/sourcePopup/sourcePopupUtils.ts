/**
 * Source Popup Utilities
 *
 * Helper functions for positioning and managing popups in Source mode (CodeMirror 6).
 */

import type { EditorView } from "@codemirror/view";
import type { AnchorRect, BoundaryRects } from "@/utils/popupPosition";
import { getViewportBounds } from "@/utils/popupPosition";

/**
 * Get the editor container element for a CodeMirror view.
 */
export function getEditorContainer(view: EditorView): HTMLElement | null {
  return view.dom.closest(".editor-container") as HTMLElement | null;
}

/**
 * Get the popup host element for a CodeMirror view.
 * Prefer the editor container to ensure popups stay scoped.
 */
export function getPopupHost(view: EditorView): HTMLElement | null {
  return getEditorContainer(view) ?? (view.dom.parentElement as HTMLElement | null);
}

/**
 * Get popup host for a DOM element (e.g., CM editor DOM).
 */
export function getPopupHostForDom(dom: HTMLElement | null): HTMLElement | null {
  if (!dom) return null;
  return (dom.closest(".editor-container") as HTMLElement | null) ?? dom.parentElement;
}

/**
 * Convert viewport coordinates to popup-host coordinates (DOM variant).
 */
export function toHostCoordsForDom(
  host: HTMLElement,
  point: { top: number; left: number }
): { top: number; left: number } {
  const rect = host.getBoundingClientRect();
  return {
    top: point.top - rect.top + host.scrollTop,
    left: point.left - rect.left + host.scrollLeft,
  };
}

/**
 * Convert viewport coordinates to popup-host coordinates.
 */
export function toHostCoords(
  host: HTMLElement,
  point: { top: number; left: number }
): { top: number; left: number } {
  const rect = host.getBoundingClientRect();
  return {
    top: point.top - rect.top + host.scrollTop,
    left: point.left - rect.left + host.scrollLeft,
  };
}

/**
 * Get anchor rect from a document range using CM6's coordsAtPos.
 *
 * @param view - CodeMirror EditorView
 * @param from - Start position
 * @param to - End position
 * @returns AnchorRect or null if coords unavailable
 */
export function getAnchorRectFromRange(
  view: EditorView,
  from: number,
  to: number
): AnchorRect | null {
  const startCoords = view.coordsAtPos(from);
  const endCoords = view.coordsAtPos(to);

  if (!startCoords || !endCoords) {
    return null;
  }

  return {
    top: startCoords.top,
    left: startCoords.left,
    bottom: endCoords.bottom,
    right: endCoords.right,
  };
}

/**
 * Get boundary rects from the editor container.
 * Uses .editor-container for vertical bounds, editor DOM for horizontal.
 *
 * @param view - CodeMirror EditorView
 * @returns BoundaryRects for popup positioning
 */
export function getEditorBounds(view: EditorView): BoundaryRects {
  const container = view.dom.closest(".editor-container") as HTMLElement | null;

  if (!container) {
    return getViewportBounds();
  }

  const editorRect = view.dom.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  return {
    horizontal: { left: editorRect.left, right: editorRect.right },
    vertical: { top: containerRect.top, bottom: containerRect.bottom },
  };
}

/**
 * Check if a document position is visible in the editor viewport.
 *
 * @param view - CodeMirror EditorView
 * @param pos - Document position
 * @returns true if position is visible
 */
export function isPositionVisible(view: EditorView, pos: number): boolean {
  const coords = view.coordsAtPos(pos);
  if (!coords) return false;

  const container = view.dom.closest(".editor-container") as HTMLElement | null;
  if (!container) {
    // Fallback to window viewport
    return coords.top >= 0 && coords.bottom <= window.innerHeight;
  }

  const containerRect = container.getBoundingClientRect();
  return coords.top >= containerRect.top && coords.bottom <= containerRect.bottom;
}

/**
 * Get the line number for a document position.
 *
 * @param view - CodeMirror EditorView
 * @param pos - Document position
 * @returns Line number (1-indexed)
 */
export function getLineNumber(view: EditorView, pos: number): number {
  return view.state.doc.lineAt(pos).number;
}

/**
 * Scroll a position into view if not already visible.
 *
 * @param view - CodeMirror EditorView
 * @param pos - Document position to scroll to
 */
export function scrollIntoViewIfNeeded(view: EditorView, pos: number): void {
  if (!isPositionVisible(view, pos)) {
    view.dispatch({
      selection: { anchor: pos },
      scrollIntoView: true,
    });
  }
}

/**
 * Convert a CM6 position to line/column coordinates.
 *
 * @param view - CodeMirror EditorView
 * @param pos - Document position
 * @returns Object with line (1-indexed) and column (0-indexed)
 */
export function posToLineCol(
  view: EditorView,
  pos: number
): { line: number; col: number } {
  const line = view.state.doc.lineAt(pos);
  return {
    line: line.number,
    col: pos - line.from,
  };
}

/**
 * Convert line/column to a CM6 position.
 *
 * @param view - CodeMirror EditorView
 * @param line - Line number (1-indexed)
 * @param col - Column (0-indexed)
 * @returns Document position
 */
export function lineColToPos(
  view: EditorView,
  line: number,
  col: number
): number {
  const docLine = view.state.doc.line(Math.min(line, view.state.doc.lines));
  return Math.min(docLine.from + col, docLine.to);
}
