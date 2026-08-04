/**
 * Popup host DOM helpers
 *
 * Purpose: generic, editor-agnostic DOM utilities for anchoring popups to a
 * host element. Moved here from plugins/sourcePopup (WI-8): ~8 plugins across
 * both WYSIWYG and Source surfaces consume these, which made sourcePopup a
 * second de-facto shared layer. Anything CodeMirror-specific (EditorView
 * bounds, positions, anchor rects) stays in sourcePopup/sourcePopupUtils.
 */

/**
 * Get the popup host for a DOM element (e.g., an editor's root DOM node).
 * Prefers the enclosing `.editor-container` so popups stay scoped to the
 * editor; falls back to the element's parent.
 */
export function getPopupHostForDom(dom: HTMLElement | null): HTMLElement | null {
  if (!dom) return null;
  return (dom.closest(".editor-container") as HTMLElement | null) ?? dom.parentElement;
}

/**
 * Convert viewport coordinates to popup-host coordinates.
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
