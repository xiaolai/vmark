/**
 * Context Detection for Source Mode Format Popup
 *
 * Determines which toolbar mode to show based on cursor position.
 * Handles Cmd+E keyboard shortcut by routing to appropriate popup.
 * Uses cached cursor context for fast routing, calls detection functions for full info.
 */

import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { useSourceFormatStore } from "@/stores/sourceFormatStore";
import { useSourceCursorContextStore } from "@/stores/sourceCursorContextStore";
import { getSourceTableInfo } from "./tableDetection";
import { getHeadingInfo } from "./headingDetection";
import { getCodeFenceInfo } from "./codeFenceDetection";
import { getBlockMathInfo } from "./blockMathDetection";
import { getListItemInfo } from "./listDetection";
import { getBlockquoteInfo } from "./blockquoteDetection";
import { getSelectionRect, getCursorRect } from "./positionUtils";

// Re-export for backward compatibility
export { getSelectionRect, getCursorRect, getContextModeSource } from "./positionUtils";

/**
 * Toggle table popup visibility. Called via keyboard shortcut.
 * Shows table popup if cursor is in a table, otherwise does nothing.
 * Uses cached context for fast check, detection function for full info.
 */
export function toggleTablePopup(view: EditorView): boolean {
  const store = useSourceFormatStore.getState();
  const ctx = useSourceCursorContextStore.getState().context;

  // If table popup is already open, close it (no cursor to restore for tables)
  if (store.isOpen && store.mode === "table") {
    store.closePopup(); // Returns null for tables (no auto-select)
    return true;
  }

  // Fast check using cached context
  if (!ctx.inTable) {
    return false; // Not in table, don't consume the key
  }

  // Get full table info for popup
  const tableInfo = getSourceTableInfo(view);
  if (!tableInfo) return false;

  const { from } = view.state.selection.main;
  const rect = getCursorRect(view, from);
  if (!rect) return false;

  store.openTablePopup({
    anchorRect: rect,
    editorView: view,
    tableInfo,
  });

  return true;
}

/**
 * Trigger format popup at cursor position via keyboard shortcut.
 * Shows context-aware popup based on cursor location following priority order:
 * 1. Toggle if already open
 * 2. Code fence → CODE toolbar
 * 3. Block math → MATH toolbar
 * 4. Table → TABLE toolbar (merged)
 * 5. List → LIST toolbar (merged)
 * 6. Blockquote → BLOCKQUOTE toolbar (merged)
 * 7. Has selection → FORMAT toolbar
 * 7.5. Formatted range → FORMAT toolbar (auto-select content)
 * 8-11. Inline elements (link, image, math, footnote)
 * 12-13. Heading or paragraph line start → HEADING toolbar
 * 14-15. Word → FORMAT toolbar (auto-select)
 * 16-17. Blank line or otherwise → INSERT toolbar
 *
 * Uses cached cursor context for fast routing, detection functions for full info.
 */
export function triggerFormatPopup(view: EditorView): boolean {
  const store = useSourceFormatStore.getState();
  const ctx = useSourceCursorContextStore.getState().context;
  const { from, to } = view.state.selection.main;

  // 1. Toggle: if popup is already open, close it and restore cursor
  if (store.isOpen) {
    const originalCursorPos = store.closePopup();
    if (originalCursorPos !== null) {
      view.dispatch({
        selection: EditorSelection.cursor(originalCursorPos),
      });
    }
    return true;
  }

  // 2. Code fence → CODE toolbar
  if (ctx.inCodeBlock) {
    const codeFenceInfo = getCodeFenceInfo(view);
    if (!codeFenceInfo) return false;

    const rect = getCursorRect(view, from);
    if (!rect) return false;

    store.openCodePopup({
      anchorRect: rect,
      editorView: view,
      codeFenceInfo,
    });
    return true;
  }

  // 3. Block math ($$...$$) → MATH toolbar
  if (ctx.inBlockMath) {
    const blockMathInfo = getBlockMathInfo(view);
    if (!blockMathInfo) return false;

    const rect = getCursorRect(view, from);
    if (!rect) return false;

    store.openMathPopup({
      anchorRect: rect,
      editorView: view,
      blockMathInfo,
    });
    return true;
  }

  // 4. Table → TABLE toolbar (merged with format)
  if (ctx.inTable) {
    const tableInfo = getSourceTableInfo(view);
    if (!tableInfo) return false;

    const rect = getCursorRect(view, from);
    if (!rect) return false;

    store.openTablePopup({
      anchorRect: rect,
      editorView: view,
      tableInfo,
    });
    return true;
  }

  // 5. List → LIST toolbar (merged with format)
  if (ctx.inList) {
    const listInfo = getListItemInfo(view);
    if (!listInfo) return false;

    const rect = getCursorRect(view, from);
    if (!rect) return false;

    store.openListPopup({
      anchorRect: rect,
      editorView: view,
      listInfo,
    });
    return true;
  }

  // 6. Blockquote → BLOCKQUOTE toolbar (merged with format)
  if (ctx.inBlockquote) {
    const blockquoteInfo = getBlockquoteInfo(view);
    if (!blockquoteInfo) return false;

    const rect = getCursorRect(view, from);
    if (!rect) return false;

    store.openBlockquotePopup({
      anchorRect: rect,
      editorView: view,
      blockquoteInfo,
    });
    return true;
  }

  // 7. Has selection → FORMAT toolbar (honor user's selection)
  if (ctx.hasSelection) {
    const rect = getSelectionRect(view, from, to);
    if (!rect) return false;

    const selectedText = view.state.doc.sliceString(from, to);
    store.openPopup({
      anchorRect: rect,
      selectedText,
      editorView: view,
      contextMode: "format",
    });
    return true;
  }

  // 7.5. Cursor in formatted range → FORMAT toolbar (auto-select content)
  if (ctx.innermostFormat) {
    const fmt = ctx.innermostFormat;
    // Auto-select the content (excluding markers)
    view.dispatch({
      selection: { anchor: fmt.contentFrom, head: fmt.contentTo },
    });

    const rect = getSelectionRect(view, fmt.contentFrom, fmt.contentTo);
    if (!rect) return false;

    const selectedText = view.state.doc.sliceString(fmt.contentFrom, fmt.contentTo);
    store.openPopup({
      anchorRect: rect,
      selectedText,
      editorView: view,
      contextMode: "format",
    });
    return true;
  }

  // 8-11. Check inline elements (link, image, math, footnote)
  // 9. Image → Do nothing (has own popup on click)
  if (ctx.inImage) {
    return false;
  }

  // 11. Footnote → FOOTNOTE toolbar
  if (ctx.inFootnote) {
    const fn = ctx.inFootnote;
    const rect = getSelectionRect(view, fn.from, fn.to);
    if (!rect) return false;

    // Auto-select the footnote label
    view.dispatch({
      selection: { anchor: fn.contentFrom, head: fn.contentTo },
    });

    store.openFootnotePopup({
      anchorRect: rect,
      editorView: view,
    });
    return true;
  }

  // 8. Link → FORMAT toolbar (auto-select content)
  if (ctx.inLink) {
    const lnk = ctx.inLink;
    const rect = getSelectionRect(view, lnk.contentFrom, lnk.contentTo);
    if (!rect) return false;

    view.dispatch({
      selection: { anchor: lnk.contentFrom, head: lnk.contentTo },
    });

    const selectedText = view.state.doc.sliceString(lnk.contentFrom, lnk.contentTo);
    store.openPopup({
      anchorRect: rect,
      selectedText,
      editorView: view,
      contextMode: "format",
    });
    return true;
  }

  // 10. Inline math → FORMAT toolbar (auto-select content)
  if (ctx.inInlineMath) {
    const mth = ctx.inInlineMath;
    const rect = getSelectionRect(view, mth.contentFrom, mth.contentTo);
    if (!rect) return false;

    view.dispatch({
      selection: { anchor: mth.contentFrom, head: mth.contentTo },
    });

    const selectedText = view.state.doc.sliceString(mth.contentFrom, mth.contentTo);
    store.openPopup({
      anchorRect: rect,
      selectedText,
      editorView: view,
      contextMode: "format",
    });
    return true;
  }

  // 12. Heading → HEADING toolbar
  // Always check detection function directly - cached context may be stale on app reopen
  const headingInfo = getHeadingInfo(view);
  if (headingInfo) {
    const rect = getCursorRect(view, from);
    if (!rect) return false;

    store.openHeadingPopup({
      anchorRect: rect,
      editorView: view,
      headingInfo,
    });
    return true;
  }

  // 13. Cursor at paragraph line start → HEADING toolbar
  if (ctx.atLineStart) {
    const rect = getCursorRect(view, from);
    if (!rect) return false;

    const line = view.state.doc.lineAt(from);
    store.openHeadingPopup({
      anchorRect: rect,
      editorView: view,
      headingInfo: {
        level: 0, // paragraph
        lineStart: line.from,
        lineEnd: line.to,
      },
    });
    return true;
  }

  // 14-15. Cursor in word → FORMAT toolbar (auto-select word)
  if (ctx.inWord) {
    const rect = getSelectionRect(view, ctx.inWord.from, ctx.inWord.to);
    if (!rect) return false;

    // Save original cursor position for restore on cancel
    const originalCursorPos = from;

    // Auto-select the word
    view.dispatch({
      selection: { anchor: ctx.inWord.from, head: ctx.inWord.to },
    });

    const selectedText = view.state.doc.sliceString(ctx.inWord.from, ctx.inWord.to);
    store.openPopup({
      anchorRect: rect,
      selectedText,
      editorView: view,
      contextMode: "format",
      originalCursorPos,
    });
    return true;
  }

  // 16-17. Blank line or otherwise → INSERT toolbar
  const rect = getCursorRect(view, from);
  if (!rect) return false;

  store.openPopup({
    anchorRect: rect,
    selectedText: "",
    editorView: view,
    contextMode: ctx.contextMode,
  });

  return true;
}
