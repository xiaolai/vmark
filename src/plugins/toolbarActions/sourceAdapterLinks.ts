/**
 * Source Adapter Links
 *
 * Link-related toolbar actions for source mode.
 * Handles hyperlinks, wiki links, and bookmark links.
 *
 * @coordinates-with sourceMathActions.ts — math functions extracted from this file
 * @module plugins/toolbarActions/sourceAdapterLinks
 */

import type { EditorView } from "@codemirror/view";
import { getAnchorRectFromRange } from "@/plugins/sourcePopup/sourcePopupUtils";
import { useHeadingPickerStore } from "@/stores/headingPickerStore";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { useLinkCreatePopupStore } from "@/stores/linkCreatePopupStore";
import { generateSlug, makeUniqueSlug, type HeadingWithId } from "@/utils/headingSlug";
import { getBoundaryRects, getViewportBounds } from "@/utils/popupPosition";
import { readClipboardUrl } from "@/services/editor/clipboardUrl";
import { findWordBoundaries } from "@/utils/wordSegmentation";

/**
 * Find word boundaries at cursor position in CodeMirror.
 * Returns document positions for the word containing the cursor.
 */
export function findWordAtCursorSource(
  view: EditorView,
  pos: number
): { from: number; to: number } | null {
  const line = view.state.doc.lineAt(pos);
  const lineText = line.text;
  const offsetInLine = pos - line.from;

  const boundaries = findWordBoundaries(lineText, offsetInLine);
  if (!boundaries) return null;

  return {
    from: line.from + boundaries.start,
    to: line.from + boundaries.end,
  };
}

/**
 * Link range result from detection.
 */
interface LinkRange {
  from: number;
  to: number;
  href: string;
  text: string;
}

/**
 * Find markdown link at cursor position.
 * Detects: [text](url) or [text](url "title")
 * Does NOT match image syntax ![...](...) or wiki-links [[...]]
 */
function findLinkAtCursor(view: EditorView, pos: number): LinkRange | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;

  // Regex to match link syntax (not images):
  // - [text](url) or [text](url "title")
  // - [text](<url with spaces>) or [text](<url> "title")
  // Captures: [1] = text, [2] = angle bracket url, [3] = url
  const linkRegex = /\[([^\]]*)\]\((?:<([^>]+)>|([^)\s"]+))(?:\s+"[^"]*")?\)/g;

  let match;
  while ((match = linkRegex.exec(lineText)) !== null) {
    const matchStart = lineStart + match.index;
    const matchEnd = matchStart + match[0].length;

    // Skip if this is an image (preceded by !)
    if (match.index > 0 && lineText[match.index - 1] === "!") {
      continue;
    }

    // Check if cursor is inside this link markdown
    /* v8 ignore next -- @preserve reason: link match not at cursor position loop iteration not tested */
    if (pos >= matchStart && pos <= matchEnd) {
      const text = match[1];
      const href = match[2] || match[3];

      return {
        from: matchStart,
        to: matchEnd,
        href,
        text,
      };
    }
  }

  return null;
}

/**
 * Show the link popup for an existing link at cursor position.
 * Returns true if popup was shown, false if not inside a link.
 */
function showLinkPopupForExistingLink(view: EditorView): boolean {
  const { from } = view.state.selection.main;
  const link = findLinkAtCursor(view, from);

  if (!link) {
    return false;
  }

  // Get anchor rect for popup positioning
  const anchorRect = getAnchorRectFromRange(view, link.from, link.to);
  if (!anchorRect) {
    return false;
  }

  // Open the link popup
  useLinkPopupStore.getState().openPopup({
    href: link.href,
    linkFrom: link.from,
    linkTo: link.to,
    anchorRect,
  });

  return true;
}

/**
 * Check if cursor is inside an image markdown: ![alt](src)
 */
function isInsideImage(view: EditorView, pos: number): boolean {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;

  const imageRegex = /!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s"]+))(?:\s+"[^"]*")?\)/g;

  let match;
  while ((match = imageRegex.exec(lineText)) !== null) {
    const matchStart = lineStart + match.index;
    const matchEnd = matchStart + match[0].length;

    /* v8 ignore next -- @preserve reason: image match not at cursor position loop iteration not tested */
    if (pos >= matchStart && pos <= matchEnd) {
      return true;
    }
  }

  return false;
}

/**
 * Insert a link with a known URL, wrapping the text from `from` to `to`.
 * Places cursor at the end of the link.
 */
function insertLinkWithUrl(
  view: EditorView,
  from: number,
  to: number,
  url: string
): void {
  const linkText = view.state.doc.sliceString(from, to);
  const markdown = `[${linkText}](${url})`;

  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: { anchor: from + markdown.length },
  });
  view.focus();
}

/**
 * Open the link create popup with given parameters.
 */
function openLinkCreatePopup(
  view: EditorView,
  text: string,
  rangeFrom: number,
  rangeTo: number,
  showTextInput: boolean
): void {
  const anchorRect = getAnchorRectFromRange(view, rangeFrom, rangeTo);
  if (!anchorRect) return;

  useLinkCreatePopupStore.getState().openPopup({
    text,
    rangeFrom,
    rangeTo,
    anchorRect,
    showTextInput,
  });
}

/**
 * Insert a markdown hyperlink with smart clipboard URL detection.
 *
 * Behavior:
 * - Cursor inside existing link → show popup for editing
 * - Has selection + clipboard URL → [selection](clipboard_url)
 * - Has selection, no URL → open create popup with URL input only
 * - No selection, word at cursor + clipboard URL → [word](clipboard_url)
 * - No selection, word at cursor, no URL → open create popup with URL input only
 * - No selection, no word + clipboard URL → [](clipboard_url) with cursor in text
 * - No selection, no word, no URL → open create popup with text + URL inputs
 */
export async function insertLink(view: EditorView): Promise<boolean> {
  const { from, to } = view.state.selection.main;

  // Case 0a: Cursor inside existing link - show popup for editing
  if (from === to && showLinkPopupForExistingLink(view)) {
    return true;
  }

  // Case 0b: Inside an image - don't insert link inside image
  if (isInsideImage(view, from)) {
    return true;
  }

  // Block if create popup is already open
  if (useLinkCreatePopupStore.getState().isOpen) {
    return true;
  }

  const clipboardUrl = await readClipboardUrl();

  // Case 1: Has selection
  if (from !== to) {
    if (clipboardUrl) {
      insertLinkWithUrl(view, from, to, clipboardUrl);
    } else {
      // Open create popup with URL input only (text is selected)
      const selectedText = view.state.doc.sliceString(from, to);
      openLinkCreatePopup(view, selectedText, from, to, false);
    }
    return true;
  }

  // Case 2: No selection - try word expansion
  const wordRange = findWordAtCursorSource(view, from);
  if (wordRange) {
    if (clipboardUrl) {
      insertLinkWithUrl(view, wordRange.from, wordRange.to, clipboardUrl);
    } else {
      // Open create popup with URL input only (word will be wrapped)
      const wordText = view.state.doc.sliceString(wordRange.from, wordRange.to);
      openLinkCreatePopup(view, wordText, wordRange.from, wordRange.to, false);
    }
    return true;
  }

  // Case 3: No selection, no word at cursor
  if (clipboardUrl) {
    // Insert [](clipboardUrl) with cursor in text position
    const text = `[](${clipboardUrl})`;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + 1 }, // After "["
    });
    view.focus();
  } else {
    // Open create popup with both text and URL inputs
    openLinkCreatePopup(view, "", from, to, true);
  }
  return true;
}

/**
 * Synchronous version of insertLink for use in keymap handlers.
 * Fires the async insertLink and returns true immediately.
 */
export function insertLinkSync(view: EditorView): boolean {
  void insertLink(view);
  return true;
}

/**
 * Insert wiki-style syntax with optional prefix/suffix.
 * Used for [[wiki links]] and ![[embeds]].
 */
export function insertWikiSyntax(
  view: EditorView,
  prefix: string,
  suffix: string,
  defaultValue: string
): boolean {
  const { from, to } = view.state.selection.main;
  const selectedText = from !== to ? view.state.doc.sliceString(from, to) : "";
  const value = selectedText || defaultValue;
  const text = `${prefix}${value}${suffix}`;
  const cursorOffset = prefix.length + value.length; // position after value, before suffix
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + cursorOffset },
  });
  view.focus();
  return true;
}

/**
 * Extract headings from markdown text with generated IDs.
 * Used for bookmark link picker.
 */
export function extractMarkdownHeadings(text: string): HeadingWithId[] {
  const headings: HeadingWithId[] = [];
  const usedSlugs = new Set<string>();
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;

  while ((match = headingRegex.exec(text)) !== null) {
    const level = match[1].length;
    const headingText = match[2].trim();
    const baseSlug = generateSlug(headingText);
    const id = makeUniqueSlug(baseSlug, usedSlugs);

    /* v8 ignore next -- @preserve reason: duplicate heading slug generating empty id not tested */
    if (id) {
      usedSlugs.add(id);
      headings.push({ level, text: headingText, id, pos: match.index });
    }
  }

  return headings;
}

/**
 * Insert a bookmark link to a heading in the document.
 * Opens heading picker and inserts [text](#heading-id) on selection.
 */
export function insertSourceBookmarkLink(view: EditorView): boolean {
  const docText = view.state.doc.toString();
  const headings = extractMarkdownHeadings(docText);

  if (headings.length === 0) {
    return false;
  }

  // Capture selected text for link text fallback (not position-sensitive)
  const { from, to } = view.state.selection.main;
  const capturedSelectedText = from !== to ? view.state.doc.sliceString(from, to) : "";

  // Get anchor rect from selection for popup positioning
  const coords = view.coordsAtPos(from);
  const anchorRect = coords ? {
    top: coords.top,
    bottom: coords.bottom,
    left: coords.left,
    right: coords.left + 10, // Minimal width for cursor position
  } : undefined;

  // Get container bounds for proper popup positioning
  const containerEl = view.dom.closest(".editor-container") as HTMLElement;
  const containerBounds = containerEl
    ? getBoundaryRects(view.dom as HTMLElement, containerEl)
    : getViewportBounds();

  useHeadingPickerStore.getState().openPicker(headings, (id, text) => {
    // Re-read current state to get fresh positions (doc may have changed)
    const { from: currentFrom, to: currentTo } = view.state.selection.main;
    const linkText = capturedSelectedText || text;
    const markdown = `[${linkText}](#${id})`;

    view.dispatch({
      changes: { from: currentFrom, to: currentTo, insert: markdown },
      selection: { anchor: currentFrom + markdown.length },
    });
    view.focus();
  }, { anchorRect, containerBounds });

  return true;
}

