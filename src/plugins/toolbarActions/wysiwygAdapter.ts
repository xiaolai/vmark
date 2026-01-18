import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { NodeSelection, Selection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { insertFootnoteAndOpenPopup } from "@/plugins/footnotePopup/tiptapInsertFootnote";
import { expandedToggleMarkTiptap } from "@/plugins/editorPlugins.tiptap";
import { resolveLinkPopupPayload } from "@/plugins/formatToolbar/linkPopupUtils";
import { handleBlockquoteNest, handleBlockquoteUnnest, handleRemoveBlockquote, handleListIndent, handleListOutdent, handleRemoveList, handleToBulletList, handleToOrderedList } from "@/plugins/formatToolbar/nodeActions.tiptap";
import { addColLeft, addColRight, addRowAbove, addRowBelow, alignColumn, deleteCurrentColumn, deleteCurrentRow, deleteCurrentTable } from "@/plugins/tableUI/tableActions.tiptap";
import { findWordAtCursor } from "@/plugins/syntaxReveal/marks";
import { useLinkPopupStore } from "@/stores/linkPopupStore";
import { readClipboardUrl } from "@/utils/clipboardUrl";
import { canRunActionInMultiSelection } from "./multiSelectionPolicy";
import type { WysiwygToolbarContext } from "./types";
import { applyMultiSelectionBlockquoteAction, applyMultiSelectionHeading, applyMultiSelectionListAction } from "./wysiwygMultiSelection";
import { insertWikiLink, insertWikiEmbed, insertBookmarkLink, insertReferenceLink } from "./wysiwygAdapterLinks";

const DEFAULT_MATH_BLOCK = "c = \\pm\\sqrt{a^2 + b^2}";

async function emitMenuEvent(eventName: string) {
  const windowLabel = getCurrentWebviewWindow().label;
  await emit(eventName, windowLabel);
}

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
 * Insert a new text node with link mark when no selection exists.
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
 * Smart link insertion with clipboard URL detection.
 * Returns true if handled, false to fall back to popup.
 */
async function trySmartLinkInsertion(view: EditorView, inLink: boolean): Promise<boolean> {
  // If already in a link, don't use clipboard - let user edit existing link
  if (inLink) return false;

  const clipboardUrl = await readClipboardUrl();
  if (!clipboardUrl) return false;

  const { from, to } = view.state.selection;

  // Has selection: apply link directly
  if (from !== to) {
    applyLinkWithUrl(view, from, to, clipboardUrl);
    return true;
  }

  // No selection: try word expansion
  const $from = view.state.selection.$from;
  const wordRange = findWordAtCursor($from);
  if (wordRange) {
    applyLinkWithUrl(view, wordRange.from, wordRange.to, clipboardUrl);
    return true;
  }

  // No selection, no word: insert URL as linked text
  insertLinkAtCursor(view, clipboardUrl);
  return true;
}

function openLinkEditor(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const inLink = !!context.context?.inLink;

  // Try smart link insertion first (async, fires and forgets)
  void trySmartLinkInsertion(view, inLink).then((handled) => {
    if (handled) return;

    // Fall back to popup or word expansion
    const selection = view.state.selection;
    const payload = resolveLinkPopupPayload(
      { from: selection.from, to: selection.to },
      context.context?.inLink ?? null
    );

    if (!payload) {
      expandedToggleMarkTiptap(view, "link");
      return;
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
    } catch {
      expandedToggleMarkTiptap(view, "link");
    }
  });

  return true;
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

/**
 * Insert inline math with word expansion.
 *
 * Behavior:
 * - Cursor at math_inline node → unwrap (convert to text)
 * - Has selection → wrap in math_inline, position cursor to enter edit mode
 * - No selection, word at cursor → wrap word, position cursor to enter edit mode
 * - No selection, no word → insert empty math_inline, enter edit mode
 */
function insertInlineMath(context: WysiwygToolbarContext): boolean {
  const view = context.view;
  if (!view) return false;

  const { state, dispatch } = view;
  const { from, to } = state.selection;
  const mathInlineType = state.schema.nodes.math_inline;
  if (!mathInlineType) return false;

  const $from = state.selection.$from;

  // Check if we're in a NodeSelection of a math node - toggle off (unwrap)
  if (state.selection instanceof NodeSelection) {
    const node = state.selection.node;
    if (node.type.name === "math_inline") {
      const content = node.attrs.content || "";
      const pos = state.selection.from;
      const tr = state.tr.replaceWith(
        pos,
        pos + node.nodeSize,
        content ? state.schema.text(content) : []
      );
      tr.setSelection(Selection.near(tr.doc.resolve(pos + content.length)));
      dispatch(tr);
      view.focus();
      return true;
    }
  }

  // Check if cursor's nodeAfter is math_inline - toggle off (unwrap)
  const nodeAfter = $from.nodeAfter;
  if (nodeAfter?.type.name === "math_inline") {
    const nodeEnd = from + nodeAfter.nodeSize;
    const content = nodeAfter.attrs.content || "";
    const tr = state.tr.replaceWith(
      from,
      nodeEnd,
      content ? state.schema.text(content) : []
    );
    tr.setSelection(Selection.near(tr.doc.resolve(from + content.length)));
    dispatch(tr);
    view.focus();
    return true;
  }

  // Check if cursor's nodeBefore is math_inline - toggle off (unwrap)
  const nodeBefore = $from.nodeBefore;
  if (nodeBefore?.type.name === "math_inline") {
    const nodeStart = from - nodeBefore.nodeSize;
    const content = nodeBefore.attrs.content || "";
    const tr = state.tr.replaceWith(
      nodeStart,
      from,
      content ? state.schema.text(content) : []
    );
    tr.setSelection(Selection.near(tr.doc.resolve(nodeStart + content.length)));
    dispatch(tr);
    view.focus();
    return true;
  }

  // Helper to focus math input after insertion with cursor at specific offset
  const focusMathInput = (cursorOffset?: number) => {
    requestAnimationFrame(() => {
      const mathInput = view.dom.querySelector(".math-inline.editing .math-inline-input") as HTMLInputElement;
      if (mathInput) {
        mathInput.focus();
        if (cursorOffset !== undefined) {
          mathInput.setSelectionRange(cursorOffset, cursorOffset);
        }
      }
    });
  };

  // Case 1: Has selection - wrap in math_inline, enter edit mode
  if (from !== to) {
    const selectedText = state.doc.textBetween(from, to, "");
    const mathNode = mathInlineType.create({ content: selectedText });
    const tr = state.tr.replaceSelectionWith(mathNode);
    tr.setSelection(Selection.near(tr.doc.resolve(from)));
    dispatch(tr);
    focusMathInput(selectedText.length);
    return true;
  }

  // Case 2: No selection - try word expansion
  const wordRange = findWordAtCursor($from);
  if (wordRange) {
    const wordText = state.doc.textBetween(wordRange.from, wordRange.to, "");
    // Calculate cursor offset within the word (restore cursor position)
    const cursorOffsetInWord = from - wordRange.from;
    const mathNode = mathInlineType.create({ content: wordText });
    const tr = state.tr.replaceWith(wordRange.from, wordRange.to, mathNode);
    tr.setSelection(Selection.near(tr.doc.resolve(wordRange.from)));
    dispatch(tr);
    focusMathInput(cursorOffsetInWord);
    return true;
  }

  // Case 3: No selection, no word - insert empty math node, enter edit mode
  const mathNode = mathInlineType.create({ content: "" });
  const tr = state.tr.replaceSelectionWith(mathNode);
  tr.setSelection(Selection.near(tr.doc.resolve(from)));
  dispatch(tr);
  focusMathInput(0);
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
    case "insertInlineMath":
      return insertInlineMath(context);
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
      return insertReferenceLink(context);
    default:
      return false;
  }
}
