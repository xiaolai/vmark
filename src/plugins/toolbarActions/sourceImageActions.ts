/**
 * Source Image Actions
 *
 * Image insertion, link detection, and unlink handlers for source (CodeMirror) mode.
 * Extracted from sourceAdapter.ts to keep files under ~300 lines.
 *
 * @coordinates-with sourceAdapter.ts — main dispatcher imports these handlers
 * @module plugins/toolbarActions/sourceImageActions
 */

import type { EditorView } from "@codemirror/view";
import { getAnchorRectFromRange } from "@/plugins/sourcePopup/sourcePopupUtils";
import { readClipboardImagePath } from "@/utils/clipboardImagePath";
import { copyImageToAssets } from "@/hooks/useImageOperations";
import { encodeMarkdownUrl } from "@/utils/markdownUrl";
import { useDocumentStore } from "@/stores/documentStore";
import { useMediaPopupStore, type MediaNodeType } from "@/stores/mediaPopupStore";
import { hasVideoExtension, hasAudioExtension } from "@/utils/mediaPathDetection";
import { useTabStore } from "@/stores/tabStore";
import { getWindowLabel } from "@/hooks/useWindowFocus";
import { insertText } from "./sourceAdapterHelpers";
import { findWordAtCursorSource } from "./sourceAdapterLinks";
import {
  findMarkdownLinkAtPosition,
  findWikiLinkAtPosition,
  type MarkdownLinkMatch,
  type WikiLinkMatch,
} from "@/utils/markdownLinkPatterns";

// --- Helper functions ---

/**
 * Get the active document file path for the current window.
 */
function getActiveFilePath(): string | null {
  try {
    const windowLabel = getWindowLabel();
    const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
    if (!tabId) return null;
    return useDocumentStore.getState().getDocument(tabId)?.filePath ?? null;
  } catch {
    return null;
  }
}

// --- Smart image insertion ---

/**
 * Image range result from detection.
 */
interface ImageRange {
  from: number;
  to: number;
  src: string;
  alt: string;
}

/**
 * Find markdown image at cursor position.
 * Detects: ![alt](src) or ![alt](src "title")
 */
function findImageAtCursor(view: EditorView, pos: number): ImageRange | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const lineText = line.text;
  const lineStart = line.from;

  // Regex to match image syntax:
  // - ![alt](path) or ![alt](path "title")
  // - ![alt](<path with spaces>) - angle bracket syntax
  // Captures: [1] = alt, [2] = angle bracket path, [3] = regular path
  const imageRegex = /!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s"]+))(?:\s+"[^"]*")?\)/g;

  let match;
  while ((match = imageRegex.exec(lineText)) !== null) {
    const matchStart = lineStart + match.index;
    const matchEnd = matchStart + match[0].length;

    // Check if cursor is inside this image markdown
    // Use pos < matchEnd since CodeMirror ranges are [from, to)
    if (pos >= matchStart && pos < matchEnd) {
      const alt = match[1];
      const src = match[2] || match[3];

      return {
        from: matchStart,
        to: matchEnd,
        src,
        alt,
      };
    }
  }

  return null;
}

/**
 * Show the image popup for an existing image at cursor position.
 * Returns true if popup was shown, false if not inside an image.
 */
function showImagePopupForExistingImage(view: EditorView): boolean {
  const { from } = view.state.selection.main;
  const image = findImageAtCursor(view, from);

  if (!image) {
    return false;
  }

  // Get anchor rect for popup positioning
  const anchorRect = getAnchorRectFromRange(view, image.from, image.to);
  if (!anchorRect) {
    return false;
  }

  // Derive media type from file extension (image syntax is used for all media in source mode)
  let mediaNodeType: MediaNodeType = "image";
  if (hasVideoExtension(image.src)) mediaNodeType = "block_video";
  else if (hasAudioExtension(image.src)) mediaNodeType = "block_audio";

  // Open the media popup
  useMediaPopupStore.getState().openPopup({
    mediaSrc: image.src,
    mediaAlt: image.alt,
    mediaNodePos: image.from,
    mediaNodeType,
    anchorRect,
  });

  return true;
}

/**
 * Find markdown link at cursor position using shared utility.
 */
function findLinkAtCursor(view: EditorView, pos: number): MarkdownLinkMatch | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  return findMarkdownLinkAtPosition(line.text, line.from, pos);
}

/**
 * Check if cursor is inside a link markdown: [text](url)
 * Does NOT match images (preceded by !)
 */
function isInsideLink(view: EditorView, pos: number): boolean {
  return findLinkAtCursor(view, pos) !== null;
}

/**
 * Find wiki link at cursor position using shared utility.
 */
function findWikiLinkAtCursor(view: EditorView, pos: number): WikiLinkMatch | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  return findWikiLinkAtPosition(line.text, line.from, pos);
}

/**
 * Remove link markdown at cursor, preserving the link text.
 * [text](url) -> text
 * [[target]] -> target
 * [[target|alias]] -> alias
 */
export function unlinkAtCursor(view: EditorView): boolean {
  const { from } = view.state.selection.main;

  // Try regular link first
  const link = findLinkAtCursor(view, from);
  if (link) {
    view.dispatch({
      changes: { from: link.from, to: link.to, insert: link.text },
      selection: { anchor: link.from + link.text.length },
    });
    view.focus();
    return true;
  }

  // Try wiki link
  const wikiLink = findWikiLinkAtCursor(view, from);
  if (wikiLink) {
    // Use alias if present, otherwise use target
    const displayText = wikiLink.alias ?? wikiLink.target;
    view.dispatch({
      changes: { from: wikiLink.from, to: wikiLink.to, insert: displayText },
      selection: { anchor: wikiLink.from + displayText.length },
    });
    view.focus();
    return true;
  }

  return false;
}

/**
 * Insert image markdown with smart clipboard detection and word expansion.
 *
 * Behavior:
 * - Cursor inside existing image -> show popup for editing
 * - Clipboard has image URL -> insert directly
 * - Clipboard has local path -> copy to assets, insert relative path
 * - Selection exists -> use as alt text
 * - No selection, word at cursor -> use word as alt text
 * - No clipboard image -> insert template ![](url)
 */
async function insertImageAsync(view: EditorView): Promise<boolean> {
  const { from, to } = view.state.selection.main;

  // Case 0a: Cursor inside existing image - show popup for editing
  if (from === to && showImagePopupForExistingImage(view)) {
    return true;
  }

  // Case 0b: Inside a link - don't insert image inside link
  if (isInsideLink(view, from)) {
    return true;
  }

  const clipboardResult = await readClipboardImagePath();

  // Determine alt text from selection or word expansion
  let altText = "";
  let insertFrom = from;
  let insertTo = to;

  if (from !== to) {
    // Has selection: use as alt text
    altText = view.state.doc.sliceString(from, to);
  } else {
    // No selection: try word expansion
    const wordRange = findWordAtCursorSource(view, from);
    if (wordRange) {
      altText = view.state.doc.sliceString(wordRange.from, wordRange.to);
      insertFrom = wordRange.from;
      insertTo = wordRange.to;
    }
  }

  // Check if we have a valid clipboard image path
  if (clipboardResult?.isImage && clipboardResult.validated) {
    let imagePath = clipboardResult.path;

    // For local paths that need copying, copy to assets
    if (clipboardResult.needsCopy) {
      const docPath = getActiveFilePath();
      if (!docPath) {
        // Can't copy without document path, fall back to template
        insertImageTemplate(view, insertFrom, insertTo, altText);
        return true;
      }

      try {
        const sourcePath = clipboardResult.resolvedPath ?? clipboardResult.path;
        imagePath = await copyImageToAssets(sourcePath, docPath);
      } catch {
        // Copy failed, fall back to template
        insertImageTemplate(view, insertFrom, insertTo, altText);
        return true;
      }
    }

    // Insert image with the path (encode URL for spaces)
    const markdown = `![${altText}](${encodeMarkdownUrl(imagePath)})`;
    view.dispatch({
      changes: { from: insertFrom, to: insertTo, insert: markdown },
      selection: { anchor: insertFrom + markdown.length },
    });
    view.focus();
    return true;
  }

  // No valid clipboard image, insert template
  insertImageTemplate(view, insertFrom, insertTo, altText);
  return true;
}

/**
 * Insert image template with cursor positioned appropriately.
 */
function insertImageTemplate(
  view: EditorView,
  from: number,
  to: number,
  altText: string
): void {
  if (altText) {
    // Has alt text: position cursor in URL part
    const markdown = `![${altText}](url)`;
    const urlStart = from + altText.length + 4; // After "![alt]("
    view.dispatch({
      changes: { from, to, insert: markdown },
      selection: { anchor: urlStart, head: urlStart + 3 }, // Select "url"
    });
  } else {
    // No alt text: position cursor in alt text part
    const markdown = "![](url)";
    view.dispatch({
      changes: { from, to, insert: markdown },
      selection: { anchor: from + 2 }, // After "!["
    });
  }
  view.focus();
}

/**
 * Synchronous wrapper for insertImageAsync.
 * Fires the async operation and returns immediately.
 */
export function insertImage(view: EditorView): boolean {
  insertImageAsync(view).catch((error) => {
    console.error("[SourceAdapter] insertImage failed:", error);
  });
  return true;
}

export function insertVideoTag(view: EditorView): boolean {
  const template = '<video src="" controls></video>';
  // Position cursor inside src=""
  const cursorOffset = 12; // after '<video src="'
  insertText(view, template, cursorOffset);
  return true;
}

export function insertAudioTag(view: EditorView): boolean {
  const template = '<audio src="" controls></audio>';
  const cursorOffset = 12; // after '<audio src="'
  insertText(view, template, cursorOffset);
  return true;
}
