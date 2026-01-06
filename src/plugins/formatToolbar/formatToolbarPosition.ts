/**
 * Format Toolbar Position
 *
 * Position calculation and visibility management for the format toolbar.
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type AnchorRect,
} from "@/utils/popupPosition";

/**
 * Calculate toolbar position relative to anchor.
 */
export function calculateToolbarPosition(
  container: HTMLElement,
  editorView: EditorView,
  anchorRect: AnchorRect
): { top: number; left: number } {
  const containerEl = editorView.dom.closest(".editor-container") as HTMLElement;
  const bounds = containerEl
    ? getBoundaryRects(editorView.dom as HTMLElement, containerEl)
    : getViewportBounds();

  const toolbarWidth = container.offsetWidth || 280;
  const toolbarHeight = container.offsetHeight || 36;

  return calculatePopupPosition({
    anchor: anchorRect,
    popup: { width: toolbarWidth, height: toolbarHeight },
    bounds,
    gap: 8,
    preferAbove: true,
  });
}

/**
 * Apply position to toolbar container.
 */
export function applyToolbarPosition(
  container: HTMLElement,
  position: { top: number; left: number }
): void {
  container.style.top = `${position.top}px`;
  container.style.left = `${position.left}px`;
}

/**
 * Show the toolbar at the given anchor position.
 */
export function showToolbar(
  container: HTMLElement,
  editorView: EditorView,
  anchorRect: AnchorRect
): void {
  container.style.display = "flex";
  container.style.position = "fixed";
  const position = calculateToolbarPosition(container, editorView, anchorRect);
  applyToolbarPosition(container, position);
}

/**
 * Update toolbar position.
 */
export function updateToolbarPosition(
  container: HTMLElement,
  editorView: EditorView,
  anchorRect: AnchorRect
): void {
  const position = calculateToolbarPosition(container, editorView, anchorRect);
  applyToolbarPosition(container, position);
}

/**
 * Hide the toolbar.
 */
export function hideToolbar(container: HTMLElement): void {
  container.style.display = "none";
}
