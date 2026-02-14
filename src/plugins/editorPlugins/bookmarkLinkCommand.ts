/**
 * Purpose: Bookmark link shortcut handler for WYSIWYG mode.
 * Opens the heading picker to insert an in-document link (#heading-id).
 *
 * Exports:
 * - handleBookmarkLinkShortcut
 *
 * @coordinates-with editorPlugins.tiptap.ts (keymap builder binds this)
 * @coordinates-with headingPickerStore.ts (heading picker popup state)
 * @coordinates-with utils/headingSlug.ts (heading extraction)
 * @coordinates-with utils/popupPosition.ts (popup positioning)
 */

import type { EditorView } from "@tiptap/pm/view";
import { useHeadingPickerStore } from "@/stores/headingPickerStore";
import { extractHeadingsWithIds } from "@/utils/headingSlug";
import { getBoundaryRects, getViewportBounds } from "@/utils/popupPosition";

/**
 * Insert bookmark link by opening heading picker.
 */
export function handleBookmarkLinkShortcut(view: EditorView): boolean {
  // Block if heading picker is already open
  if (useHeadingPickerStore.getState().isOpen) {
    return true;
  }

  const { state } = view;
  const headings = extractHeadingsWithIds(state.doc);
  if (headings.length === 0) {
    // No headings - could show a toast here
    return false;
  }

  const { from, to } = state.selection;
  const selectedText = from !== to ? state.doc.textBetween(from, to) : "";

  // Get anchor rect for popup positioning
  // When there's no selection width, we need a minimum width for the anchor rect
  // so the popup positioning algorithm has something to align with.
  const MINIMUM_ANCHOR_WIDTH = 10;
  const coords = view.coordsAtPos(from);
  const anchorRect = {
    top: coords.top,
    bottom: coords.bottom,
    left: coords.left,
    right: coords.left + MINIMUM_ANCHOR_WIDTH,
  };

  const containerEl = view.dom.closest(".editor-container") as HTMLElement;
  const containerBounds = containerEl
    ? getBoundaryRects(view.dom as HTMLElement, containerEl)
    : getViewportBounds();

  useHeadingPickerStore.getState().openPicker(headings, (id, text) => {
    const currentState = view.state;
    const linkMark = currentState.schema.marks.link;
    if (!linkMark) return;

    const tr = currentState.tr;
    const linkText = selectedText || text;
    const linkMarkInstance = linkMark.create({ href: `#${id}` });

    if (from === to) {
      // No selection - insert link with heading text
      const textNode = currentState.schema.text(linkText, [linkMarkInstance]);
      tr.insert(from, textNode);
    } else {
      // Has selection - apply link mark to selection
      tr.addMark(from, to, linkMarkInstance);
    }

    view.dispatch(tr);
    view.focus();
  }, { anchorRect, containerBounds });

  return true;
}
