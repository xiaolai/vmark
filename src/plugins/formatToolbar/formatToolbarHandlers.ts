/**
 * Format Toolbar Handlers
 *
 * Action handlers for format toolbar operations.
 */

import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection } from "@milkdown/kit/prose/state";
import { useFormatToolbarStore } from "@/stores/formatToolbarStore";
import { expandedToggleMark } from "@/plugins/editorPlugins";
import { addRecentLanguage } from "@/plugins/sourceFormatPopup/languages";

/**
 * Insert action configuration.
 */
interface InsertConfig {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Get insert configuration for an action.
 */
function getInsertConfig(action: string, from: number): InsertConfig | null {
  switch (action) {
    case "inline-image":
      return { text: "![](url)", selectionStart: from + 4, selectionEnd: from + 7 };
    case "inline-math":
      return { text: "$formula$", selectionStart: from + 1, selectionEnd: from + 8 };
    case "footnote":
      return { text: "[^1]", selectionStart: from + 4, selectionEnd: from + 4 };
    case "block-image":
      return { text: "![](url)\n", selectionStart: from + 4, selectionEnd: from + 7 };
    case "ordered-list":
      return { text: "1. ", selectionStart: from + 3, selectionEnd: from + 3 };
    case "unordered-list":
      return { text: "- ", selectionStart: from + 2, selectionEnd: from + 2 };
    case "blockquote":
      return { text: "> ", selectionStart: from + 2, selectionEnd: from + 2 };
    case "table":
      return {
        text: "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n",
        selectionStart: from + 2,
        selectionEnd: from + 10,
      };
    case "divider":
      return { text: "---\n", selectionStart: from + 4, selectionEnd: from + 4 };
    default:
      return null;
  }
}

/**
 * Handle language change for code blocks.
 */
export function handleLanguageChange(editorView: EditorView, language: string): void {
  const { state, dispatch } = editorView;
  const store = useFormatToolbarStore.getState();
  const codeBlockInfo = store.codeBlockInfo;

  if (!codeBlockInfo) return;

  const { nodePos } = codeBlockInfo;
  const node = state.doc.nodeAt(nodePos);

  if (node) {
    const tr = state.tr.setNodeMarkup(nodePos, undefined, {
      ...node.attrs,
      language,
    });
    dispatch(tr);
  }

  addRecentLanguage(language);
  editorView.focus();
  store.clearOriginalCursor();
  store.closeToolbar();
}

/**
 * Handle inline format toggle (bold, italic, etc.).
 */
export function handleFormat(editorView: EditorView, markType: string): void {
  editorView.focus();
  expandedToggleMark(editorView, markType);
  const store = useFormatToolbarStore.getState();
  store.clearOriginalCursor();
  store.closeToolbar();
}

/**
 * Handle heading level change.
 */
export function handleHeadingChange(editorView: EditorView, level: number): void {
  const { state, dispatch } = editorView;
  const store = useFormatToolbarStore.getState();
  const headingInfo = store.headingInfo;

  if (!headingInfo) return;

  const { nodePos } = headingInfo;

  if (level === 0) {
    const paragraphType = state.schema.nodes.paragraph;
    if (paragraphType) {
      const tr = state.tr.setNodeMarkup(nodePos, paragraphType);
      dispatch(tr);
    }
  } else {
    const headingType = state.schema.nodes.heading;
    if (headingType) {
      const tr = state.tr.setNodeMarkup(nodePos, headingType, { level });
      dispatch(tr);
    }
  }

  editorView.focus();
  store.clearOriginalCursor();
  store.closeToolbar();
}

/**
 * Handle content insertion (image, math, list, etc.).
 */
export function handleInsert(editorView: EditorView, action: string): void {
  const { state, dispatch } = editorView;
  const { from } = state.selection;

  const config = getInsertConfig(action, from);
  if (!config) return;

  const tr = state.tr.insertText(config.text, from);
  dispatch(tr);

  const newTr = editorView.state.tr.setSelection(
    TextSelection.create(editorView.state.doc, config.selectionStart, config.selectionEnd)
  );
  editorView.dispatch(newTr);

  editorView.focus();
  const store = useFormatToolbarStore.getState();
  store.clearOriginalCursor();
  store.closeToolbar();
}
