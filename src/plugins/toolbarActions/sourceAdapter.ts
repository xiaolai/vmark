import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { applyFormat, type FormatType } from "@/plugins/sourceFormatPopup";
import { clearAllFormatting } from "@/plugins/sourceFormatPopup/clearFormatting";
import { applyInlineFormatToSelections } from "@/plugins/sourceFormatPopup/formatMultiSelection";
import { buildAlertBlock, buildDetailsBlock, buildMathBlock, type AlertType } from "@/plugins/sourceFormatPopup/sourceInsertions";
import { getBlockquoteInfo, nestBlockquote, removeBlockquote, unnestBlockquote } from "@/plugins/sourceFormatPopup/blockquoteDetection";
import { convertToHeading, getHeadingInfo, setHeadingLevel } from "@/plugins/sourceFormatPopup/headingDetection";
import { getListItemInfo, indentListItem, outdentListItem, removeList, toBulletList, toOrderedList, toTaskList } from "@/plugins/sourceFormatPopup/listDetection";
import { getSourceTableInfo } from "@/plugins/sourceFormatPopup/tableDetection";
import { deleteColumn, deleteRow, deleteTable, insertColumnLeft, insertColumnRight, insertRowAbove, insertRowBelow, setAllColumnsAlignment, setColumnAlignment } from "@/plugins/sourceFormatPopup/tableActions";
import { useHeadingPickerStore } from "@/stores/headingPickerStore";
import { generateSlug, makeUniqueSlug, type HeadingWithId } from "@/utils/headingSlug";
import { canRunActionInMultiSelection } from "./multiSelectionPolicy";
import type { SourceToolbarContext } from "./types";
import { applyMultiSelectionBlockquoteAction, applyMultiSelectionHeading, applyMultiSelectionListAction } from "./sourceMultiSelection";

const TABLE_TEMPLATE = "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n";

function insertText(view: EditorView, text: string, cursorOffset?: number) {
  const { from, to } = view.state.selection.main;
  const anchor = from;

  view.dispatch({
    changes: { from, to, insert: text },
    selection: {
      anchor: typeof cursorOffset === "number" ? anchor + cursorOffset : anchor + text.length,
    },
  });
  view.focus();
}

function applyInlineFormat(view: EditorView, format: FormatType): boolean {
  const { selection } = view.state;
  if (selection.ranges.length > 1) {
    if (format === "footnote" || format === "image" || format === "link") return false;
    return applyInlineFormatToSelections(view, format);
  }

  const { from, to } = selection.main;
  if (from === to) return false;
  applyFormat(view, format);
  return true;
}

function clearFormattingSelections(view: EditorView): boolean {
  const { selection, doc } = view.state;
  if (selection.ranges.length <= 1) return false;
  const hasSelection = selection.ranges.some((range) => range.from !== range.to);
  if (!hasSelection) return false;

  const docText = doc.toString();
  const transaction = view.state.changeByRange((range) => {
    if (range.from === range.to) return { range };
    const selectedText = docText.slice(range.from, range.to);
    const cleared = clearAllFormatting(selectedText);
    return {
      changes: { from: range.from, to: range.to, insert: cleared },
      range: EditorSelection.range(range.from, range.from + cleared.length),
    };
  });

  view.dispatch(transaction);
  view.focus();
  return true;
}

function insertLink(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  if (from !== to) {
    applyFormat(view, "link");
    return true;
  }

  const text = "[](url)";
  const cursorOffset = 3; // inside url
  insertText(view, text, cursorOffset);
  return true;
}

function insertWikiSyntax(view: EditorView, prefix: string, suffix: string, defaultValue: string): boolean {
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

function extractMarkdownHeadings(text: string): HeadingWithId[] {
  const headings: HeadingWithId[] = [];
  const usedSlugs = new Set<string>();
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;

  while ((match = headingRegex.exec(text)) !== null) {
    const level = match[1].length;
    const headingText = match[2].trim();
    const baseSlug = generateSlug(headingText);
    const id = makeUniqueSlug(baseSlug, usedSlugs);

    if (id) {
      usedSlugs.add(id);
      headings.push({ level, text: headingText, id, pos: match.index });
    }
  }

  return headings;
}

function insertSourceBookmarkLink(view: EditorView): boolean {
  const docText = view.state.doc.toString();
  const headings = extractMarkdownHeadings(docText);

  if (headings.length === 0) {
    return false;
  }

  const { from, to } = view.state.selection.main;
  const selectedText = from !== to ? view.state.doc.sliceString(from, to) : "";

  useHeadingPickerStore.getState().openPicker(headings, (id, text) => {
    const linkText = selectedText || text;
    const markdown = `[${linkText}](#${id})`;

    view.dispatch({
      changes: { from, to, insert: markdown },
      selection: { anchor: from + markdown.length },
    });
    view.focus();
  });

  return true;
}

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
    case "link":
      return insertLink(view);
    case "link:wiki":
      return insertWikiSyntax(view, "[[", "]]", "page");
    case "link:wikiEmbed":
      return insertWikiSyntax(view, "![[", "]]", "file");
    case "link:bookmark":
      return insertSourceBookmarkLink(view);
    case "link:reference":
      // Not yet implemented - requires reference manager
      return false;
    case "clearFormatting": {
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
    case "insertImage":
      return insertImage(view);
    case "insertFootnote":
      return insertFootnote(view);
    case "bulletList": {
      if (applyMultiSelectionListAction(view, action)) return true;
      const info = getListItemInfo(view);
      if (!info) return false;
      toBulletList(view, info);
      return true;
    }
    case "orderedList": {
      if (applyMultiSelectionListAction(view, action)) return true;
      const info = getListItemInfo(view);
      if (!info) return false;
      toOrderedList(view, info);
      return true;
    }
    case "taskList": {
      if (applyMultiSelectionListAction(view, action)) return true;
      const info = getListItemInfo(view);
      if (!info) return false;
      toTaskList(view, info);
      return true;
    }
    case "indent": {
      if (applyMultiSelectionListAction(view, action)) return true;
      const info = getListItemInfo(view);
      if (!info) return false;
      indentListItem(view, info);
      return true;
    }
    case "outdent": {
      if (applyMultiSelectionListAction(view, action)) return true;
      const info = getListItemInfo(view);
      if (!info) return false;
      outdentListItem(view, info);
      return true;
    }
    case "removeList": {
      if (applyMultiSelectionListAction(view, action)) return true;
      const info = getListItemInfo(view);
      if (!info) return false;
      removeList(view, info);
      return true;
    }
    case "insertTable":
      return insertTable(view);
    case "addRowAbove": {
      const info = getSourceTableInfo(view);
      if (!info) return false;
      insertRowAbove(view, info);
      return true;
    }
    case "addRow": {
      const info = getSourceTableInfo(view);
      if (!info) return false;
      insertRowBelow(view, info);
      return true;
    }
    case "addColLeft": {
      const info = getSourceTableInfo(view);
      if (!info) return false;
      insertColumnLeft(view, info);
      return true;
    }
    case "addCol": {
      const info = getSourceTableInfo(view);
      if (!info) return false;
      insertColumnRight(view, info);
      return true;
    }
    case "deleteRow": {
      const info = getSourceTableInfo(view);
      if (!info) return false;
      deleteRow(view, info);
      return true;
    }
    case "deleteCol": {
      const info = getSourceTableInfo(view);
      if (!info) return false;
      deleteColumn(view, info);
      return true;
    }
    case "deleteTable": {
      const info = getSourceTableInfo(view);
      if (!info) return false;
      deleteTable(view, info);
      return true;
    }
    case "alignLeft": {
      const info = getSourceTableInfo(view);
      if (!info) return false;
      setColumnAlignment(view, info, "left");
      return true;
    }
    case "alignCenter": {
      const info = getSourceTableInfo(view);
      if (!info) return false;
      setColumnAlignment(view, info, "center");
      return true;
    }
    case "alignRight": {
      const info = getSourceTableInfo(view);
      if (!info) return false;
      setColumnAlignment(view, info, "right");
      return true;
    }
    case "alignAllLeft": {
      const info = getSourceTableInfo(view);
      if (!info) return false;
      setAllColumnsAlignment(view, info, "left");
      return true;
    }
    case "alignAllCenter": {
      const info = getSourceTableInfo(view);
      if (!info) return false;
      setAllColumnsAlignment(view, info, "center");
      return true;
    }
    case "alignAllRight": {
      const info = getSourceTableInfo(view);
      if (!info) return false;
      setAllColumnsAlignment(view, info, "right");
      return true;
    }
    case "nestQuote": {
      if (applyMultiSelectionBlockquoteAction(view, action)) return true;
      const info = getBlockquoteInfo(view);
      if (!info) return false;
      nestBlockquote(view, info);
      return true;
    }
    case "unnestQuote": {
      if (applyMultiSelectionBlockquoteAction(view, action)) return true;
      const info = getBlockquoteInfo(view);
      if (!info) return false;
      unnestBlockquote(view, info);
      return true;
    }
    case "removeQuote": {
      if (applyMultiSelectionBlockquoteAction(view, action)) return true;
      const info = getBlockquoteInfo(view);
      if (!info) return false;
      removeBlockquote(view, info);
      return true;
    }
    case "insertCodeBlock":
      return insertCodeBlock(view);
    case "insertBlockquote":
      return insertBlockquote(view);
    case "insertDivider":
      return insertDivider(view);
    case "insertTableBlock":
      return insertTable(view);
    case "insertBulletList":
      return insertListMarker(view, "- ");
    case "insertOrderedList":
      return insertListMarker(view, "1. ");
    case "insertTaskList":
      return insertListMarker(view, "- [ ] ");
    case "insertDetails": {
      const { from, to } = view.state.selection.main;
      const selection = from === to ? "" : view.state.doc.sliceString(from, to);
      const { text, cursorOffset } = buildDetailsBlock(selection);
      insertText(view, text, cursorOffset);
      return true;
    }
    case "insertAlertNote":
    case "insertAlertTip":
    case "insertAlertImportant":
    case "insertAlertWarning":
    case "insertAlertCaution": {
      const alertType = action.replace("insertAlert", "").toUpperCase() as AlertType;
      const { text, cursorOffset } = buildAlertBlock(alertType);
      insertText(view, text, cursorOffset);
      return true;
    }
    case "insertMath": {
      const { from, to } = view.state.selection.main;
      const selection = from === to ? "" : view.state.doc.sliceString(from, to);
      const { text, cursorOffset } = buildMathBlock(selection);
      insertText(view, text, cursorOffset);
      return true;
    }
    default:
      return false;
  }
}
