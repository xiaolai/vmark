/**
 * Purpose: Link-related keyboard shortcut handlers for WYSIWYG mode.
 *
 * Exports:
 * - handleSmartLinkShortcut: Smart link insertion with clipboard URL detection
 * - handleUnlinkShortcut: Remove link mark keeping text
 * - handleWikiLinkShortcut: Insert/edit wiki link
 *
 * @coordinates-with editorPlugins.tiptap.ts (keymap builder binds these)
 * @coordinates-with linkPopupStore.ts, linkCreatePopupStore.ts, wikiLinkPopupStore.ts, headingPickerStore.ts (popup state)
 * @coordinates-with syntaxReveal/marks.ts (findMarkRange, findWordAtCursor)
 */

import type { EditorView } from "@tiptap/pm/view";
import { useHeadingPickerStore } from "@/stores/headingPickerStore";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { useLinkCreatePopupStore } from "@/stores/linkCreatePopupStore";
import { useWikiLinkPopupStore } from "@/stores/wikiLinkPopupStore";
import { expandedToggleMark } from "@/plugins/editorPlugins/expandedToggleMark";
import { findMarkRange, findWordAtCursor } from "@/plugins/syntaxReveal/marks";
import { readClipboardUrl } from "@/utils/clipboardUrl";

/**
 * Apply a link mark with a specific href to a range.
 */
function applyLinkWithUrl(view: EditorView, from: number, to: number, url: string): void {
  const { state, dispatch } = view;
  const linkMark = state.schema.marks.link;
  if (!linkMark) return;

  const tr = state.tr.addMark(from, to, linkMark.create({ href: url }));
  dispatch(tr);
  view.focus();
}

/**
 * Insert a new text node with link mark when no selection/word exists.
 */
function insertLinkAtCursor(view: EditorView, url: string): void {
  const { state, dispatch } = view;
  const linkMark = state.schema.marks.link;
  if (!linkMark) return;

  const { from } = state.selection;
  const textNode = state.schema.text(url, [linkMark.create({ href: url })]);
  const tr = state.tr.insert(from, textNode);
  dispatch(tr);
  view.focus();
}

/**
 * Open link popup for editing a regular hyperlink.
 */
function openLinkPopup(
  view: EditorView,
  markRange: { from: number; to: number },
  href: string
): boolean {
  try {
    const start = view.coordsAtPos(markRange.from);
    const end = view.coordsAtPos(markRange.to);
    useLinkPopupStore.getState().openPopup({
      href,
      linkFrom: markRange.from,
      linkTo: markRange.to,
      anchorRect: {
        top: Math.min(start.top, end.top),
        left: Math.min(start.left, end.left),
        bottom: Math.max(start.bottom, end.bottom),
        right: Math.max(start.right, end.right),
      },
    });
    // Don't call view.focus() - let popup focus its input
    return true;
  } catch {
    // Fall back to toggle if coords fail
    return expandedToggleMark(view, "link");
  }
}

/**
 * Open link create popup with given parameters.
 */
function openLinkCreatePopup(
  view: EditorView,
  text: string,
  rangeFrom: number,
  rangeTo: number,
  showTextInput: boolean
): void {
  try {
    const start = view.coordsAtPos(rangeFrom);
    const end = view.coordsAtPos(rangeTo);
    useLinkCreatePopupStore.getState().openPopup({
      text,
      rangeFrom,
      rangeTo,
      anchorRect: {
        top: Math.min(start.top, end.top),
        left: Math.min(start.left, end.left),
        bottom: Math.max(start.bottom, end.bottom),
        right: Math.max(start.right, end.right),
      },
      showTextInput,
    });
  } catch (error) {
    console.error("[LinkCreatePopup] Failed to open:", error);
  }
}

/**
 * Smart link insertion with clipboard URL detection for WYSIWYG mode.
 * Checks clipboard for URL and applies link directly if found.
 * Opens create popup when no clipboard URL to let user enter URL.
 *
 * When cursor is inside an existing link:
 * - Bookmark link (href starts with #): opens heading picker
 * - Regular link: opens the link popup for editing
 *
 * When link popup, create popup, wiki link popup, or heading picker is already open, blocks the shortcut.
 */
export function handleSmartLinkShortcut(view: EditorView): boolean {
  // Block if any popup or picker is already open
  if (useLinkPopupStore.getState().isOpen ||
      useLinkCreatePopupStore.getState().isOpen ||
      useWikiLinkPopupStore.getState().isOpen ||
      useHeadingPickerStore.getState().isOpen) {
    return true;
  }

  const { from, to } = view.state.selection;
  const $from = view.state.selection.$from;

  // Check if cursor is inside a wikiLink node
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "wikiLink") {
      try {
        const nodePos = $from.before(d);
        const coords = view.coordsAtPos(nodePos);
        const endCoords = view.coordsAtPos(nodePos + node.nodeSize);

        useWikiLinkPopupStore.getState().openPopup(
          {
            top: coords.top,
            left: coords.left,
            bottom: coords.bottom,
            right: endCoords.right,
          },
          String(node.attrs.value ?? ""),
          nodePos
        );
        return true;
      } catch {
        // Fall back to normal behavior if coords fail
      }
    }
  }

  // Check if we're inside an existing link
  const linkMarkType = view.state.schema.marks.link;
  if (linkMarkType) {
    const marksAtCursor = $from.marks();
    const linkMark = marksAtCursor.find((m) => m.type === linkMarkType);
    if (linkMark) {
      // Find the link's range
      const markRange = findMarkRange($from.pos, linkMark, $from.start(), $from.parent);
      if (markRange) {
        const href = linkMark.attrs.href || "";

        // All links (including bookmark links) use the same popup for editing
        return openLinkPopup(view, markRange, href);
      }
    }
  }

  // Try smart link insertion (async)
  void (async () => {
    const clipboardUrl = await readClipboardUrl();

    // Has selection
    if (from !== to) {
      if (clipboardUrl) {
        // Apply link directly with clipboard URL
        applyLinkWithUrl(view, from, to, clipboardUrl);
      } else {
        // Open create popup with URL input only (text is selected)
        const selectedText = view.state.doc.textBetween(from, to, "");
        openLinkCreatePopup(view, selectedText, from, to, false);
      }
      return;
    }

    // No selection: try word expansion
    const wordRange = findWordAtCursor($from);
    if (wordRange) {
      if (clipboardUrl) {
        applyLinkWithUrl(view, wordRange.from, wordRange.to, clipboardUrl);
      } else {
        // Open create popup with URL input only (word will be wrapped)
        const wordText = view.state.doc.textBetween(wordRange.from, wordRange.to, "");
        openLinkCreatePopup(view, wordText, wordRange.from, wordRange.to, false);
      }
      return;
    }

    // No selection, no word
    if (clipboardUrl) {
      // Insert URL as linked text
      insertLinkAtCursor(view, clipboardUrl);
    } else {
      // Open create popup with both text and URL inputs
      openLinkCreatePopup(view, "", from, to, true);
    }
  })();

  return true;
}

/**
 * Remove link from selection, keeping the text.
 */
export function handleUnlinkShortcut(view: EditorView): boolean {
  const { state, dispatch } = view;
  const linkMarkType = state.schema.marks.link;
  if (!linkMarkType) return false;

  const $from = state.selection.$from;

  // Check if cursor is in a link
  const linkMark = $from.marks().find((m) => m.type === linkMarkType);
  if (!linkMark) return false;

  // Find the link's full range
  const markRange = findMarkRange($from.pos, linkMark, $from.start(), $from.parent);
  if (!markRange) return false;

  // Remove the link mark
  const tr = state.tr.removeMark(markRange.from, markRange.to, linkMarkType);
  dispatch(tr);
  view.focus();
  return true;
}

/**
 * Insert a new wiki link at cursor.
 */
export function handleWikiLinkShortcut(view: EditorView): boolean {
  const { state, dispatch } = view;
  const wikiLinkType = state.schema.nodes.wikiLink;
  if (!wikiLinkType) return false;

  const { from, to } = state.selection;
  const selectedText = from !== to ? state.doc.textBetween(from, to) : "";

  // Create wiki link with selected text as both target and display
  const target = selectedText || "page";
  const wikiLinkNode = wikiLinkType.create(
    { value: target },
    selectedText ? state.schema.text(selectedText) : state.schema.text(target)
  );

  const tr = state.tr.replaceSelectionWith(wikiLinkNode);
  dispatch(tr);

  // Open the popup for editing
  setTimeout(() => {
    const $pos = view.state.doc.resolve(from);
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d);
      if (node.type.name === "wikiLink") {
        try {
          const nodePos = $pos.before(d);
          const coords = view.coordsAtPos(nodePos);
          const endCoords = view.coordsAtPos(nodePos + node.nodeSize);
          useWikiLinkPopupStore.getState().openPopup(
            {
              top: coords.top,
              left: coords.left,
              bottom: coords.bottom,
              right: endCoords.right,
            },
            String(node.attrs.value ?? ""),
            nodePos
          );
        } catch (err) {
          // coords fail when view is not attached or node position is invalid
          if (import.meta.env.DEV) {
            console.debug("[WikiLink shortcut] Failed to open popup:", err);
          }
        }
        break;
      }
    }
  }, 0);

  view.focus();
  return true;
}
