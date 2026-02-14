/**
 * Table DOM Utilities
 *
 * Purpose: Helpers for finding the active table element in the editor DOM.
 * Used by context menu and column resize to determine which table the user
 * is interacting with. Includes a visibility check so off-screen tables
 * (e.g., scrolled out of view) are not treated as active.
 *
 * @coordinates-with TiptapTableContextMenu.ts — uses getActiveTableElement for positioning
 * @coordinates-with columnResize.ts — uses getActiveTableElement for resize handle attachment
 * @module plugins/tableUI/tableDom
 */
import type { EditorView } from "@tiptap/pm/view";

function getSelectionAnchorElement(view: EditorView): Element | null {
  const selection = view.root instanceof Document ? view.root.getSelection() : window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const node = selection.anchorNode ?? selection.focusNode;
  if (!node) return null;

  return node instanceof Element ? node : node.parentElement;
}

function isElementVisibleInContainer(element: Element, container: HTMLElement): boolean {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  return elementRect.bottom >= containerRect.top && elementRect.top <= containerRect.bottom;
}

export function getActiveTableElement(view: EditorView): HTMLTableElement | null {
  const anchorElement = getSelectionAnchorElement(view);
  if (!anchorElement) return null;

  const table = anchorElement.closest("table");
  if (!(table instanceof HTMLTableElement)) return null;

  const scrollContainer = view.dom.closest(".editor-content") as HTMLElement | null;
  if (!scrollContainer) return table;

  if (!isElementVisibleInContainer(table, scrollContainer)) return null;

  return table;
}
