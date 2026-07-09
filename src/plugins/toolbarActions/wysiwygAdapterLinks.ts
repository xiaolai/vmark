/**
 * WYSIWYG Adapter Links
 *
 * Link-related toolbar actions for WYSIWYG mode.
 * Handles wiki links and bookmark links.
 */

import type { Mark, MarkType, ResolvedPos } from "@tiptap/pm/model";
import { useHeadingPickerStore } from "@/stores/headingPickerStore";
import { extractHeadingsWithIds } from "@/utils/headingSlug";
import { getBoundaryRects, getViewportBounds } from "@/utils/popupPosition";
import type { WysiwygToolbarContext } from "./types";

/**
 * Insert a wiki link node at the current selection.
 * Uses selected text as display text (and value if empty).
 */
export function insertWikiLink(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const { state, dispatch } = view;
  const { from, to } = state.selection;
  const selectedText = from !== to ? state.doc.textBetween(from, to) : "";
  const wikiLinkType = state.schema.nodes.wikiLink;
  if (!wikiLinkType) return false;

  // Display text: use selected text or default to "page"
  const displayText = selectedText || "page";
  const textNode = state.schema.text(displayText);

  const node = wikiLinkType.create(
    { value: displayText }, // value = target, same as display by default
    [textNode]
  );

  dispatch(state.tr.replaceSelectionWith(node));
  view.focus();
  return true;
}

/**
 * Full extent of the link mark around a caret position: locates the text
 * node at (or immediately before) the caret carrying the mark, then
 * expands over adjacent siblings with the same mark (type + attrs).
 * Returns null when the caret is not on a link.
 */
function linkMarkRangeAt(
  $pos: ResolvedPos,
  markType: MarkType
): { from: number; to: number } | null {
  const parent = $pos.parent;
  let startIndex = $pos.index();
  let node = parent.maybeChild(startIndex);
  let mark: Mark | undefined = node ? markType.isInSet(node.marks) ?? undefined : undefined;

  // At a boundary the caret resolves after the linked node — look left.
  if (!mark && startIndex > 0) {
    startIndex -= 1;
    node = parent.maybeChild(startIndex);
    mark = node ? markType.isInSet(node.marks) ?? undefined : undefined;
  }
  if (!node || !mark) return null;

  let endIndex = startIndex + 1;
  while (startIndex > 0 && mark.isInSet(parent.child(startIndex - 1).marks)) {
    startIndex -= 1;
  }
  while (endIndex < parent.childCount && mark.isInSet(parent.child(endIndex).marks)) {
    endIndex += 1;
  }

  let from = $pos.start();
  for (let i = 0; i < startIndex; i++) from += parent.child(i).nodeSize;
  let to = from;
  for (let i = startIndex; i < endIndex; i++) to += parent.child(i).nodeSize;
  return { from, to };
}

/**
 * Remove the link mark at the cursor ("unlink"). A caret removes the whole
 * surrounding link; a selection removes the mark across the selection
 * (macOS convention). Text content is untouched.
 */
export function removeLinkAtCursor(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const { state } = view;
  const linkType = state.schema.marks.link;
  /* v8 ignore next -- @preserve reason: the Tiptap schema always defines the link mark; guard for minimal test schemas */
  if (!linkType) return false;

  const { $from, from, to, empty } = state.selection;
  let start = from;
  let end = to;
  if (empty) {
    const range = linkMarkRangeAt($from, linkType);
    if (!range) return false;
    start = range.from;
    end = range.to;
  }
  if (start === end) return false;

  view.dispatch(state.tr.removeMark(start, end, linkType));
  view.focus();
  return true;
}

/**
 * Insert a bookmark link to a heading in the document.
 * Opens heading picker popup and inserts link mark with href="#heading-id".
 */
export function insertBookmarkLink(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const { state } = view;
  const headings = extractHeadingsWithIds(state.doc);

  if (headings.length === 0) {
    return false;
  }

  // Capture selected text for link text fallback (not position-sensitive)
  const { from, to } = state.selection;
  const capturedSelectedText = from !== to ? state.doc.textBetween(from, to) : "";

  // Get anchor rect from selection for popup positioning
  const coords = view.coordsAtPos(from);
  const anchorRect = {
    top: coords.top,
    bottom: coords.bottom,
    left: coords.left,
    right: coords.left + 10, // Minimal width for cursor position
  };

  // Get container bounds for proper popup positioning
  const containerEl = view.dom.closest(".editor-container") as HTMLElement | null;
  /* v8 ignore start -- @preserve reason: editor without .editor-container ancestor not tested */
  const containerBounds = containerEl
    ? getBoundaryRects(view.dom as HTMLElement, containerEl)
    : getViewportBounds();
  /* v8 ignore stop */

  useHeadingPickerStore.getState().openPicker(headings, (id, text) => {
    // Re-read current state to get fresh positions (doc may have changed)
    const currentState = view.state;
    const linkMark = currentState.schema.marks.link;
    /* v8 ignore start -- @preserve reason: schema always defines link mark in Tiptap setup */
    if (!linkMark) return;
    /* v8 ignore stop */

    const { from: currentFrom, to: currentTo } = currentState.selection;
    const href = `#${id}`;
    const linkText = capturedSelectedText || text;

    // Create link with the heading's ID as href
    const tr = currentState.tr;
    if (currentFrom === currentTo) {
      // No selection - insert new text with link mark
      const textNode = currentState.schema.text(linkText, [linkMark.create({ href })]);
      tr.insert(currentFrom, textNode);
    } else {
      // Has selection - apply link mark to it
      tr.addMark(currentFrom, currentTo, linkMark.create({ href }));
    }

    view.dispatch(tr);
    view.focus();
  }, { anchorRect, containerBounds });

  return true;
}
