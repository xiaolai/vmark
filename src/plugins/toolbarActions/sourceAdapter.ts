/**
 * Source Adapter
 *
 * Toolbar action dispatcher for source (CodeMirror) mode.
 * Routes toolbar actions to appropriate handlers.
 *
 * @coordinates-with sourceTableActions.ts — table operation handlers
 * @coordinates-with sourceCjkActions.ts — CJK formatting and text cleanup handlers
 * @coordinates-with sourceTextTransforms.ts — line operations and text transformations
 * @coordinates-with sourceImageActions.ts — image insertion, link detection, unlink
 * @module plugins/toolbarActions/sourceAdapter
 */

import type { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { clearAllFormatting } from "@/plugins/sourceContextDetection/clearFormatting";
import { buildAlertBlock, buildDetailsBlock, buildDiagramBlock, buildMarkmapBlock, buildMathBlock, type AlertType } from "@/plugins/sourceContextDetection/sourceInsertions";
import { getBlockquoteInfo, nestBlockquote, removeBlockquote, unnestBlockquote } from "@/plugins/sourceContextDetection/blockquoteDetection";
import { toggleBlockquote } from "@/plugins/sourceContextDetection/blockquoteActions";
import { convertToHeading, getHeadingInfo, setHeadingLevel } from "@/plugins/sourceContextDetection/headingDetection";
import { getListItemInfo, indentListItem, outdentListItem, removeList, toBulletList, toOrderedList, toTaskList } from "@/plugins/sourceContextDetection/listDetection";
import { expandSelectionInSource, selectBlockInSource, selectLineInSource, selectWordInSource } from "@/plugins/toolbarActions/sourceSelectionActions";
import { canRunActionInMultiSelection } from "./multiSelectionPolicy";
import type { SourceToolbarContext } from "./types";
import { applyMultiSelectionBlockquoteAction, applyMultiSelectionHeading, applyMultiSelectionListAction } from "./sourceMultiSelection";
import { insertText, applyInlineFormat, clearFormattingSelections } from "./sourceAdapterHelpers";
import { insertLinkSync, insertWikiSyntax, insertSourceBookmarkLink, insertInlineMath } from "./sourceAdapterLinks";
import { handleTableAction } from "./sourceTableActions";
import { handleFormatCJK, handleFormatCJKFile, handleRemoveTrailingSpaces, handleCollapseBlankLines, handleLineEndings } from "./sourceCjkActions";
import {
  handleMoveLineUp, handleMoveLineDown, handleDuplicateLine, handleDeleteLine,
  handleJoinLines, handleSortLinesAsc, handleSortLinesDesc, handleRemoveBlankLines,
  handleTransformCase, toUpperCase, toLowerCase, toTitleCase, toggleCase,
} from "./sourceTextTransforms";
import { insertImage, insertVideoTag, insertAudioTag, unlinkAtCursor } from "./sourceImageActions";

// Re-export formatCJKCurrentBlock for external consumers
export { formatCJKCurrentBlock } from "./sourceCjkActions";

const TABLE_TEMPLATE = "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n";

// --- Simple insertion helpers ---

function insertFootnote(view: EditorView): boolean {
  return applyInlineFormat(view, "footnote");
}

function insertCodeBlock(view: EditorView): boolean {
  insertText(view, "```\n\n```", 4);
  return true;
}

function insertOrToggleBlockquote(view: EditorView): boolean {
  // Use toggleBlockquote for proper toggle behavior
  toggleBlockquote(view);
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

function increaseHeadingLevel(view: EditorView): boolean {
  const info = getHeadingInfo(view);
  if (info && info.level < 6) {
    setHeadingLevel(view, info, info.level + 1);
    return true;
  }
  if (!info) {
    convertToHeading(view, 1);
    return true;
  }
  return false;
}

function decreaseHeadingLevel(view: EditorView): boolean {
  const info = getHeadingInfo(view);
  if (info && info.level > 1) {
    setHeadingLevel(view, info, info.level - 1);
    return true;
  }
  if (info && info.level === 1) {
    setHeadingLevel(view, info, 0);
    return true;
  }
  return false;
}

export function performSourceToolbarAction(action: string, context: SourceToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;
  if (!canRunActionInMultiSelection(action, context.multiSelection)) return false;

  switch (action) {
    // Edit
    case "undo":
      return undo(view);
    case "redo":
      return redo(view);

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
    case "unlink":
      return unlinkAtCursor(view);

    // Clear formatting
    case "clearFormatting":
      return handleClearFormatting(view);
    case "increaseHeading":
      return increaseHeadingLevel(view);
    case "decreaseHeading":
      return decreaseHeadingLevel(view);

    // Simple insertions
    case "insertImage":
      return insertImage(view);
    case "insertVideo":
      return insertVideoTag(view);
    case "insertAudio":
      return insertAudioTag(view);
    case "insertFootnote":
      return insertFootnote(view);
    case "insertCodeBlock":
      return insertCodeBlock(view);
    case "insertBlockquote":
      return insertOrToggleBlockquote(view);
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
    case "insertDiagram":
      return handleInsertDiagram(view);
    case "insertMarkmap":
      return handleInsertMarkmap(view);
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
    case "nestBlockquote":
    case "unnestBlockquote":
    case "removeBlockquote":
      return handleBlockquoteAction(view, action);

    // Selection
    case "selectWord":
      return selectWordInSource(view);
    case "selectLine":
      return selectLineInSource(view);
    case "selectBlock":
      return selectBlockInSource(view);
    case "expandSelection":
      return expandSelectionInSource(view);

    // CJK formatting
    case "formatCJK":
      return handleFormatCJK(view);
    case "formatCJKFile":
      return handleFormatCJKFile(view);
    case "removeTrailingSpaces":
      return handleRemoveTrailingSpaces(view);
    case "collapseBlankLines":
      return handleCollapseBlankLines(view);
    case "lineEndingsLF":
      return handleLineEndings(view, "lf");
    case "lineEndingsCRLF":
      return handleLineEndings(view, "crlf");

    // Line operations
    case "moveLineUp":
      return handleMoveLineUp(view);
    case "moveLineDown":
      return handleMoveLineDown(view);
    case "duplicateLine":
      return handleDuplicateLine(view);
    case "deleteLine":
      return handleDeleteLine(view);
    case "joinLines":
      return handleJoinLines(view);
    case "sortLinesAsc":
      return handleSortLinesAsc(view);
    case "sortLinesDesc":
      return handleSortLinesDesc(view);
    case "removeBlankLines":
      return handleRemoveBlankLines(view);

    // Text transformations
    case "transformUppercase":
      return handleTransformCase(view, toUpperCase);
    case "transformLowercase":
      return handleTransformCase(view, toLowerCase);
    case "transformTitleCase":
      return handleTransformCase(view, toTitleCase);
    case "transformToggleCase":
      return handleTransformCase(view, toggleCase);

    default:
      return false;
  }
}

// --- Action handlers (kept here because they're small and tightly coupled to the dispatcher) ---

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

function handleInsertDiagram(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const selection = from === to ? "" : view.state.doc.sliceString(from, to);
  const { text, cursorOffset } = buildDiagramBlock(selection);
  insertText(view, text, cursorOffset);
  return true;
}

function handleInsertMarkmap(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const selection = from === to ? "" : view.state.doc.sliceString(from, to);
  const { text, cursorOffset } = buildMarkmapBlock(selection);
  insertText(view, text, cursorOffset);
  return true;
}

function handleListAction(view: EditorView, action: string): boolean {
  if (applyMultiSelectionListAction(view, action)) return true;
  const info = getListItemInfo(view);

  // If already in a list, convert or modify
  if (info) {
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

  // Not in a list - create new list for list type actions
  switch (action) {
    case "bulletList":
      return insertListMarker(view, "- ");
    case "orderedList":
      return insertListMarker(view, "1. ");
    case "taskList":
      return insertListMarker(view, "- [ ] ");
    case "indent":
    case "outdent":
    case "removeList":
      // These only make sense when already in a list
      return false;
    default:
      return false;
  }
}

function handleBlockquoteAction(view: EditorView, action: string): boolean {
  if (applyMultiSelectionBlockquoteAction(view, action)) return true;
  const info = getBlockquoteInfo(view);
  if (!info) return false;

  switch (action) {
    case "nestBlockquote":
      nestBlockquote(view, info);
      return true;
    case "unnestBlockquote":
      unnestBlockquote(view, info);
      return true;
    case "removeBlockquote":
      removeBlockquote(view, info);
      return true;
    default:
      return false;
  }
}
