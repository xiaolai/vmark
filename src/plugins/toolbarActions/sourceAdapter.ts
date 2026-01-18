/**
 * Source Adapter
 *
 * Toolbar action dispatcher for source (CodeMirror) mode.
 * Routes toolbar actions to appropriate handlers.
 */

import type { EditorView } from "@codemirror/view";
import { clearAllFormatting } from "@/plugins/sourceFormatPopup/clearFormatting";
import { buildAlertBlock, buildDetailsBlock, buildMathBlock, type AlertType } from "@/plugins/sourceFormatPopup/sourceInsertions";
import { getBlockquoteInfo, nestBlockquote, removeBlockquote, unnestBlockquote } from "@/plugins/sourceFormatPopup/blockquoteDetection";
import { convertToHeading, getHeadingInfo, setHeadingLevel } from "@/plugins/sourceFormatPopup/headingDetection";
import { getListItemInfo, indentListItem, outdentListItem, removeList, toBulletList, toOrderedList, toTaskList } from "@/plugins/sourceFormatPopup/listDetection";
import { getSourceTableInfo } from "@/plugins/sourceFormatPopup/tableDetection";
import { deleteColumn, deleteRow, deleteTable, insertColumnLeft, insertColumnRight, insertRowAbove, insertRowBelow, setAllColumnsAlignment, setColumnAlignment } from "@/plugins/sourceFormatPopup/tableActions";
import { canRunActionInMultiSelection } from "./multiSelectionPolicy";
import type { SourceToolbarContext } from "./types";
import { applyMultiSelectionBlockquoteAction, applyMultiSelectionHeading, applyMultiSelectionListAction } from "./sourceMultiSelection";
import { insertText, applyInlineFormat, clearFormattingSelections } from "./sourceAdapterHelpers";
import { insertLinkSync, insertWikiSyntax, insertSourceBookmarkLink, insertSourceReferenceLink, insertInlineMath } from "./sourceAdapterLinks";

const TABLE_TEMPLATE = "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n";

// --- Simple insertion functions ---

function insertImage(view: EditorView): boolean {
  insertText(view, "![](url)", 4);
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
    case "link:wikiEmbed":
      return insertWikiSyntax(view, "![[", "]]", "file");
    case "link:bookmark":
      return insertSourceBookmarkLink(view);
    case "link:reference":
      return insertSourceReferenceLink(view);

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
