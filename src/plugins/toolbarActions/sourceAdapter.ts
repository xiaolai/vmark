/**
 * Source Adapter
 *
 * Toolbar action dispatcher for source (CodeMirror) mode.
 * Routes toolbar actions to appropriate handlers.
 */

import type { EditorView } from "@codemirror/view";
import { clearAllFormatting } from "@/plugins/sourceContextDetection/clearFormatting";
import { buildAlertBlock, buildDetailsBlock, buildMathBlock, type AlertType } from "@/plugins/sourceContextDetection/sourceInsertions";
import { getBlockquoteInfo, nestBlockquote, removeBlockquote, unnestBlockquote } from "@/plugins/sourceContextDetection/blockquoteDetection";
import { convertToHeading, getHeadingInfo, setHeadingLevel } from "@/plugins/sourceContextDetection/headingDetection";
import { getListItemInfo, indentListItem, outdentListItem, removeList, toBulletList, toOrderedList, toTaskList } from "@/plugins/sourceContextDetection/listDetection";
import { getSourceTableInfo } from "@/plugins/sourceContextDetection/tableDetection";
import { deleteColumn, deleteRow, deleteTable, formatTable, insertColumnLeft, insertColumnRight, insertRowAbove, insertRowBelow, setAllColumnsAlignment, setColumnAlignment } from "@/plugins/sourceContextDetection/tableActions";
import { getAnchorRectFromRange } from "@/plugins/sourcePopup/sourcePopupUtils";
import { canRunActionInMultiSelection } from "./multiSelectionPolicy";
import type { SourceToolbarContext } from "./types";
import { applyMultiSelectionBlockquoteAction, applyMultiSelectionHeading, applyMultiSelectionListAction } from "./sourceMultiSelection";
import { insertText, applyInlineFormat, clearFormattingSelections } from "./sourceAdapterHelpers";
import { insertLinkSync, insertWikiSyntax, insertSourceBookmarkLink, insertInlineMath, findWordAtCursorSource } from "./sourceAdapterLinks";
import { readClipboardImagePath } from "@/utils/clipboardImagePath";
import { copyImageToAssets } from "@/hooks/useImageOperations";
import { encodeMarkdownUrl } from "@/utils/markdownUrl";
import { useDocumentStore } from "@/stores/documentStore";
import { useImagePopupStore } from "@/stores/imagePopupStore";
import { useTabStore } from "@/stores/tabStore";
import { getWindowLabel } from "@/hooks/useWindowFocus";

const TABLE_TEMPLATE = "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n";

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
    if (pos >= matchStart && pos <= matchEnd) {
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

  // Open the image popup
  useImagePopupStore.getState().openPopup({
    imageSrc: image.src,
    imageAlt: image.alt,
    imageNodePos: image.from,
    imageNodeType: "image",
    anchorRect,
  });

  return true;
}

/**
 * Insert image markdown with smart clipboard detection and word expansion.
 *
 * Behavior:
 * - Cursor inside existing image → show popup for editing
 * - Clipboard has image URL → insert directly
 * - Clipboard has local path → copy to assets, insert relative path
 * - Selection exists → use as alt text
 * - No selection, word at cursor → use word as alt text
 * - No clipboard image → insert template ![](url)
 */
async function insertImageAsync(view: EditorView): Promise<boolean> {
  const { from, to } = view.state.selection.main;

  // Case 0: Cursor inside existing image - show popup for editing
  if (from === to && showImagePopupForExistingImage(view)) {
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
function insertImage(view: EditorView): boolean {
  void insertImageAsync(view);
  return true;
}

function insertFootnote(view: EditorView): boolean {
  return applyInlineFormat(view, "footnote");
}

function insertCodeBlock(view: EditorView): boolean {
  insertText(view, "```\n\n```", 4);
  return true;
}

function insertBlockquote(view: EditorView): boolean {
  insertText(view, "> ");
  return true;
}

function insertDivider(view: EditorView): boolean {
  insertText(view, "---\n");
  return true;
}

function insertTable(view: EditorView): boolean {
  insertText(view, TABLE_TEMPLATE, 2);
  return true;
}

function insertListMarker(view: EditorView, marker: string): boolean {
  insertText(view, marker);
  return true;
}

// --- Exported actions ---

export function setSourceHeadingLevel(context: SourceToolbarContext, level: number): boolean {
  const view = context.view;
  if (!view) return false;
  if (!canRunActionInMultiSelection(`heading:${level}`, context.multiSelection)) return false;

  if (applyMultiSelectionHeading(view, level)) return true;

  const info = getHeadingInfo(view);
  if (info) {
    setHeadingLevel(view, info, level);
    return true;
  }

  if (level === 0) return false;
  convertToHeading(view, level);
  return true;
}

export function performSourceToolbarAction(action: string, context: SourceToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;
  if (!canRunActionInMultiSelection(action, context.multiSelection)) return false;

  switch (action) {
    // Inline formatting
    case "bold":
      return applyInlineFormat(view, "bold");
    case "italic":
      return applyInlineFormat(view, "italic");
    case "strikethrough":
      return applyInlineFormat(view, "strikethrough");
    case "highlight":
      return applyInlineFormat(view, "highlight");
    case "superscript":
      return applyInlineFormat(view, "superscript");
    case "subscript":
      return applyInlineFormat(view, "subscript");
    case "code":
      return applyInlineFormat(view, "code");
    case "underline":
      return applyInlineFormat(view, "underline");

    // Links
    case "link":
      return insertLinkSync(view);
    case "link:wiki":
      return insertWikiSyntax(view, "[[", "]]", "page");
    case "link:bookmark":
      return insertSourceBookmarkLink(view);

    // Clear formatting
    case "clearFormatting":
      return handleClearFormatting(view);

    // Simple insertions
    case "insertImage":
      return insertImage(view);
    case "insertFootnote":
      return insertFootnote(view);
    case "insertCodeBlock":
      return insertCodeBlock(view);
    case "insertBlockquote":
      return insertBlockquote(view);
    case "insertDivider":
      return insertDivider(view);
    case "insertTable":
    case "insertTableBlock":
      return insertTable(view);
    case "insertBulletList":
      return insertListMarker(view, "- ");
    case "insertOrderedList":
      return insertListMarker(view, "1. ");
    case "insertTaskList":
      return insertListMarker(view, "- [ ] ");

    // Complex insertions
    case "insertDetails":
      return handleInsertDetails(view);
    case "insertAlertNote":
    case "insertAlertTip":
    case "insertAlertImportant":
    case "insertAlertWarning":
    case "insertAlertCaution":
      return handleInsertAlert(view, action);
    case "insertMath":
      return handleInsertMath(view);
    case "insertInlineMath":
      return insertInlineMath(view);

    // List operations
    case "bulletList":
    case "orderedList":
    case "taskList":
    case "indent":
    case "outdent":
    case "removeList":
      return handleListAction(view, action);

    // Table operations
    case "addRowAbove":
    case "addRow":
    case "addColLeft":
    case "addCol":
    case "deleteRow":
    case "deleteCol":
    case "deleteTable":
    case "alignLeft":
    case "alignCenter":
    case "alignRight":
    case "alignAllLeft":
    case "alignAllCenter":
    case "alignAllRight":
    case "formatTable":
      return handleTableAction(view, action);

    // Blockquote operations
    case "nestQuote":
    case "unnestQuote":
    case "removeQuote":
      return handleBlockquoteAction(view, action);

    default:
      return false;
  }
}

// --- Action handlers ---

function handleClearFormatting(view: EditorView): boolean {
  if (clearFormattingSelections(view)) return true;
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  const selectedText = view.state.doc.sliceString(from, to);
  const cleared = clearAllFormatting(selectedText);
  view.dispatch({
    changes: { from, to, insert: cleared },
    selection: { anchor: from, head: from + cleared.length },
  });
  view.focus();
  return true;
}

function handleInsertDetails(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const selection = from === to ? "" : view.state.doc.sliceString(from, to);
  const { text, cursorOffset } = buildDetailsBlock(selection);
  insertText(view, text, cursorOffset);
  return true;
}

function handleInsertAlert(view: EditorView, action: string): boolean {
  const alertType = action.replace("insertAlert", "").toUpperCase() as AlertType;
  const { text, cursorOffset } = buildAlertBlock(alertType);
  insertText(view, text, cursorOffset);
  return true;
}

function handleInsertMath(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const selection = from === to ? "" : view.state.doc.sliceString(from, to);
  const { text, cursorOffset } = buildMathBlock(selection);
  insertText(view, text, cursorOffset);
  return true;
}

function handleListAction(view: EditorView, action: string): boolean {
  if (applyMultiSelectionListAction(view, action)) return true;
  const info = getListItemInfo(view);
  if (!info) return false;

  switch (action) {
    case "bulletList":
      toBulletList(view, info);
      return true;
    case "orderedList":
      toOrderedList(view, info);
      return true;
    case "taskList":
      toTaskList(view, info);
      return true;
    case "indent":
      indentListItem(view, info);
      return true;
    case "outdent":
      outdentListItem(view, info);
      return true;
    case "removeList":
      removeList(view, info);
      return true;
    default:
      return false;
  }
}

function handleTableAction(view: EditorView, action: string): boolean {
  const info = getSourceTableInfo(view);
  if (!info) return false;

  switch (action) {
    case "addRowAbove":
      insertRowAbove(view, info);
      return true;
    case "addRow":
      insertRowBelow(view, info);
      return true;
    case "addColLeft":
      insertColumnLeft(view, info);
      return true;
    case "addCol":
      insertColumnRight(view, info);
      return true;
    case "deleteRow":
      deleteRow(view, info);
      return true;
    case "deleteCol":
      deleteColumn(view, info);
      return true;
    case "deleteTable":
      deleteTable(view, info);
      return true;
    case "alignLeft":
      setColumnAlignment(view, info, "left");
      return true;
    case "alignCenter":
      setColumnAlignment(view, info, "center");
      return true;
    case "alignRight":
      setColumnAlignment(view, info, "right");
      return true;
    case "alignAllLeft":
      setAllColumnsAlignment(view, info, "left");
      return true;
    case "alignAllCenter":
      setAllColumnsAlignment(view, info, "center");
      return true;
    case "alignAllRight":
      setAllColumnsAlignment(view, info, "right");
      return true;
    case "formatTable":
      formatTable(view, info);
      return true;
    default:
      return false;
  }
}

function handleBlockquoteAction(view: EditorView, action: string): boolean {
  if (applyMultiSelectionBlockquoteAction(view, action)) return true;
  const info = getBlockquoteInfo(view);
  if (!info) return false;

  switch (action) {
    case "nestQuote":
      nestBlockquote(view, info);
      return true;
    case "unnestQuote":
      unnestBlockquote(view, info);
      return true;
    case "removeQuote":
      removeBlockquote(view, info);
      return true;
    default:
      return false;
  }
}
