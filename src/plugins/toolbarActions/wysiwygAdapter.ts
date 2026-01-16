import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { insertFootnoteAndOpenPopup } from "@/plugins/footnotePopup/tiptapInsertFootnote";
import { expandedToggleMarkTiptap } from "@/plugins/editorPlugins.tiptap";
import { resolveLinkPopupPayload } from "@/plugins/formatToolbar/linkPopupUtils";
import { handleBlockquoteNest, handleBlockquoteUnnest, handleRemoveBlockquote, handleListIndent, handleListOutdent, handleRemoveList, handleToBulletList, handleToOrderedList } from "@/plugins/formatToolbar/nodeActions.tiptap";
import { addColLeft, addColRight, addRowAbove, addRowBelow, alignColumn, deleteCurrentColumn, deleteCurrentRow, deleteCurrentTable } from "@/plugins/tableUI/tableActions.tiptap";
import { useHeadingPickerStore } from "@/stores/headingPickerStore";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { extractHeadingsWithIds } from "@/utils/headingSlug";
import { canRunActionInMultiSelection } from "./multiSelectionPolicy";
import { applyMultiSelectionBlockquoteAction, applyMultiSelectionHeading, applyMultiSelectionListAction } from "./wysiwygMultiSelection";
import type { WysiwygToolbarContext } from "./types";

const DEFAULT_MATH_BLOCK = "c = \\pm\\sqrt{a^2 + b^2}";

async function emitMenuEvent(eventName: string) {
  const windowLabel = getCurrentWebviewWindow().label;
  await emit(eventName, windowLabel);
}

function openLinkEditor(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const selection = view.state.selection;
  const payload = resolveLinkPopupPayload(
    { from: selection.from, to: selection.to },
    context.context?.inLink ?? null
  );

  if (!payload) {
    return expandedToggleMarkTiptap(view, "link");
  }

  try {
    const start = view.coordsAtPos(payload.linkFrom);
    const end = view.coordsAtPos(payload.linkTo);

    useLinkPopupStore.getState().openPopup({
      href: payload.href,
      linkFrom: payload.linkFrom,
      linkTo: payload.linkTo,
      anchorRect: {
        top: Math.min(start.top, end.top),
        left: Math.min(start.left, end.left),
        bottom: Math.max(start.bottom, end.bottom),
        right: Math.max(start.right, end.right),
      },
    });
    view.focus();
    return true;
  } catch {
    return expandedToggleMarkTiptap(view, "link");
  }
}

export function setWysiwygHeadingLevel(context: WysiwygToolbarContext, level: number): boolean {
  const editor = context.editor;
  if (!editor) return false;
  if (!canRunActionInMultiSelection(`heading:${level}`, context.multiSelection)) return false;

  const view = context.view;
  if (view && applyMultiSelectionHeading(view, editor, level)) return true;

  if (level === 0) {
    editor.chain().focus().setParagraph().run();
    return true;
  }

  editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
  return true;
}

function insertMathBlock(context: WysiwygToolbarContext): boolean {
  const editor = context.editor;
  if (!editor) return false;

  editor
    .chain()
    .focus()
    .insertContent({
      type: "codeBlock",
      attrs: { language: "latex" },
      content: [{ type: "text", text: DEFAULT_MATH_BLOCK }],
    })
    .run();
  return true;
}

export function performWysiwygToolbarAction(action: string, context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!canRunActionInMultiSelection(action, context.multiSelection)) return false;

  switch (action) {
    case "bold":
      return view ? expandedToggleMarkTiptap(view, "bold") : false;
    case "italic":
      return view ? expandedToggleMarkTiptap(view, "italic") : false;
    case "underline":
      return view ? expandedToggleMarkTiptap(view, "underline") : false;
    case "strikethrough":
      return view ? expandedToggleMarkTiptap(view, "strike") : false;
    case "highlight":
      return view ? expandedToggleMarkTiptap(view, "highlight") : false;
    case "superscript":
      return view ? expandedToggleMarkTiptap(view, "superscript") : false;
    case "subscript":
      return view ? expandedToggleMarkTiptap(view, "subscript") : false;
    case "code":
      return view ? expandedToggleMarkTiptap(view, "code") : false;
    case "clearFormatting":
      void emitMenuEvent("menu:clear-format");
      return true;
    case "link":
      return openLinkEditor(context);
    case "bulletList":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? (handleToBulletList(view), true) : false;
    case "orderedList":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? (handleToOrderedList(view), true) : false;
    case "taskList":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      void emitMenuEvent("menu:task-list");
      return true;
    case "indent":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? (handleListIndent(view), true) : false;
    case "outdent":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? (handleListOutdent(view), true) : false;
    case "removeList":
      if (view && applyMultiSelectionListAction(view, action, context.editor)) return true;
      return view ? (handleRemoveList(view), true) : false;
    case "insertTable":
    case "insertTableBlock":
      void emitMenuEvent("menu:insert-table");
      return true;
    case "addRowAbove":
      return view ? addRowAbove(view) : false;
    case "addRow":
      return view ? addRowBelow(view) : false;
    case "addColLeft":
      return view ? addColLeft(view) : false;
    case "addCol":
      return view ? addColRight(view) : false;
    case "deleteRow":
      return view ? deleteCurrentRow(view) : false;
    case "deleteCol":
      return view ? deleteCurrentColumn(view) : false;
    case "deleteTable":
      return view ? deleteCurrentTable(view) : false;
    case "alignLeft":
      return view ? alignColumn(view, "left", false) : false;
    case "alignCenter":
      return view ? alignColumn(view, "center", false) : false;
    case "alignRight":
      return view ? alignColumn(view, "right", false) : false;
    case "alignAllLeft":
      return view ? alignColumn(view, "left", true) : false;
    case "alignAllCenter":
      return view ? alignColumn(view, "center", true) : false;
    case "alignAllRight":
      return view ? alignColumn(view, "right", true) : false;
    case "nestQuote":
      if (view && applyMultiSelectionBlockquoteAction(view, action)) return true;
      return view ? (handleBlockquoteNest(view), true) : false;
    case "unnestQuote":
      if (view && applyMultiSelectionBlockquoteAction(view, action)) return true;
      return view ? (handleBlockquoteUnnest(view), true) : false;
    case "removeQuote":
      if (view && applyMultiSelectionBlockquoteAction(view, action)) return true;
      return view ? (handleRemoveBlockquote(view), true) : false;
    case "insertImage":
      void emitMenuEvent("menu:image");
      return true;
    case "insertCodeBlock":
      void emitMenuEvent("menu:code-fences");
      return true;
    case "insertBlockquote":
      void emitMenuEvent("menu:quote");
      return true;
    case "insertDivider":
      void emitMenuEvent("menu:horizontal-line");
      return true;
    case "insertMath":
      return insertMathBlock(context);
    case "insertBulletList":
      void emitMenuEvent("menu:unordered-list");
      return true;
    case "insertOrderedList":
      void emitMenuEvent("menu:ordered-list");
      return true;
    case "insertTaskList":
      void emitMenuEvent("menu:task-list");
      return true;
    case "insertDetails":
      void emitMenuEvent("menu:collapsible-block");
      return true;
    case "insertAlertNote":
      void emitMenuEvent("menu:info-note");
      return true;
    case "insertAlertTip":
      void emitMenuEvent("menu:info-tip");
      return true;
    case "insertAlertImportant":
      void emitMenuEvent("menu:info-important");
      return true;
    case "insertAlertWarning":
      void emitMenuEvent("menu:info-warning");
      return true;
    case "insertAlertCaution":
      void emitMenuEvent("menu:info-caution");
      return true;
    case "insertFootnote":
      if (!context.editor) return false;
      insertFootnoteAndOpenPopup(context.editor);
      return true;
    case "link:wiki":
      return insertWikiLink(context);
    case "link:wikiEmbed":
      return insertWikiEmbed(context);
    case "link:bookmark":
      return insertBookmarkLink(context);
    case "link:reference":
      // Not yet implemented - requires reference manager
      return false;
    default:
      return false;
  }
}

function insertWikiLink(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const { state, dispatch } = view;
  const { from, to } = state.selection;
  const selectedText = from !== to ? state.doc.textBetween(from, to) : "";
  const wikiLinkType = state.schema.nodes.wikiLink;
  if (!wikiLinkType) return false;

  const node = wikiLinkType.create({
    value: selectedText || "page",
    alias: null,
  });

  dispatch(state.tr.replaceSelectionWith(node));
  view.focus();
  return true;
}

function insertWikiEmbed(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const { state, dispatch } = view;
  const { from, to } = state.selection;
  const selectedText = from !== to ? state.doc.textBetween(from, to) : "";
  const wikiEmbedType = state.schema.nodes.wikiEmbed;
  if (!wikiEmbedType) return false;

  const node = wikiEmbedType.create({
    value: selectedText || "file",
    alias: null,
  });

  dispatch(state.tr.replaceSelectionWith(node));
  view.focus();
  return true;
}

function insertBookmarkLink(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const { state } = view;
  const headings = extractHeadingsWithIds(state.doc);

  if (headings.length === 0) {
    return false;
  }

  const { from, to } = state.selection;
  const selectedText = from !== to ? state.doc.textBetween(from, to) : "";

  useHeadingPickerStore.getState().openPicker(headings, (id, text) => {
    const linkMark = state.schema.marks.link;
    if (!linkMark) return;

    const href = `#${id}`;
    const linkText = selectedText || text;

    // Create link with the heading's ID as href
    const tr = state.tr;
    if (from === to) {
      // No selection - insert new text with link mark
      const textNode = state.schema.text(linkText, [linkMark.create({ href })]);
      tr.insert(from, textNode);
    } else {
      // Has selection - apply link mark to it
      tr.addMark(from, to, linkMark.create({ href }));
    }

    view.dispatch(tr);
    view.focus();
  });

  return true;
}
