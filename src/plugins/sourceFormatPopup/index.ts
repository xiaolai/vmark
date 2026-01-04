/**
 * Source Format Popup Extension for CodeMirror
 *
 * Detects text selection and shows/hides the formatting popup.
 * Table popup is shown via keyboard shortcut, not automatically.
 * Uses debounce to avoid flicker during rapid selection changes.
 */

import { EditorView } from "@codemirror/view";
import { useSourceFormatStore } from "@/stores/sourceFormatStore";
import { useSourceCursorContextStore } from "@/stores/sourceCursorContextStore";
import { getHeadingInfo } from "./headingDetection";
import { getCodeFenceInfo } from "./codeFenceDetection";
import { getSelectionRect, getCursorRect } from "./contextDetection";
import { computeSourceCursorContext } from "./cursorContext";

// Debounce timeout for showing popup
let showTimeout: ReturnType<typeof setTimeout> | null = null;

// Minimum selection length to show popup
const MIN_SELECTION_LENGTH = 1;

// Delay before showing popup (ms)
const SHOW_DELAY = 200;

/**
 * Check if position is inside a code fence content (not on opening line).
 */
function isInCodeFenceContent(view: EditorView, pos: number): boolean {
  const codeFenceInfo = getCodeFenceInfo(view);
  if (!codeFenceInfo) return false;

  // Check if cursor is inside the fence but NOT on the opening line
  const cursorLine = view.state.doc.lineAt(pos).number;
  return cursorLine > codeFenceInfo.startLine && cursorLine <= codeFenceInfo.endLine;
}

/**
 * Check if cursor is on the opening line of a code fence (after ```).
 */
function isOnCodeFenceOpeningLine(view: EditorView, pos: number): boolean {
  const codeFenceInfo = getCodeFenceInfo(view);
  if (!codeFenceInfo) return false;

  const cursorLine = view.state.doc.lineAt(pos).number;
  return cursorLine === codeFenceInfo.startLine;
}

/**
 * Clear any pending show timeout.
 */
function clearShowTimeout() {
  if (showTimeout) {
    clearTimeout(showTimeout);
    showTimeout = null;
  }
}

/**
 * CodeMirror extension that monitors selection and manages popup visibility.
 * Also updates cursor context on every selection/doc change.
 */
export const sourceFormatExtension = EditorView.updateListener.of((update) => {
  // Update cursor context on selection or document changes
  if (update.selectionSet || update.docChanged) {
    const context = computeSourceCursorContext(update.view);
    useSourceCursorContextStore.getState().setContext(context, update.view);
  }

  // Only handle selection changes for popup
  if (!update.selectionSet) return;

  const { from, to } = update.view.state.selection.main;
  const hasSelection = to - from >= MIN_SELECTION_LENGTH;

  // Check if cursor is on code fence opening line (show language picker)
  if (!hasSelection && isOnCodeFenceOpeningLine(update.view, from)) {
    clearShowTimeout();
    showTimeout = setTimeout(() => {
      const codeFenceInfo = getCodeFenceInfo(update.view);
      if (!codeFenceInfo) return;

      const cursorLine = update.view.state.doc.lineAt(from).number;
      if (cursorLine !== codeFenceInfo.startLine) return;

      const rect = getCursorRect(update.view, from);
      if (!rect) return;

      useSourceFormatStore.getState().openCodePopup({
        anchorRect: rect,
        editorView: update.view,
        codeFenceInfo,
      });
    }, SHOW_DELAY);
    return;
  }

  if (hasSelection) {
    // Clear any pending timeout
    clearShowTimeout();

    // Schedule popup show with delay
    showTimeout = setTimeout(() => {
      // Re-check selection (might have changed during delay)
      const currentSelection = update.view.state.selection.main;
      const currentFrom = currentSelection.from;
      const currentTo = currentSelection.to;

      if (currentTo - currentFrom < MIN_SELECTION_LENGTH) {
        // No selection - close popup (table popup is triggered by shortcut)
        useSourceFormatStore.getState().closePopup();
        return;
      }

      // Don't show popup if selection is in code fence content
      if (isInCodeFenceContent(update.view, currentFrom) || isInCodeFenceContent(update.view, currentTo)) {
        useSourceFormatStore.getState().closePopup();
        return;
      }

      const rect = getSelectionRect(update.view, currentFrom, currentTo);
      if (!rect) return;

      // Check if selection is in a heading
      const headingInfo = getHeadingInfo(update.view);
      if (headingInfo) {
        useSourceFormatStore.getState().openHeadingPopup({
          anchorRect: rect,
          editorView: update.view,
          headingInfo,
        });
        return;
      }

      // Regular text selection - show format popup
      const selectedText = update.view.state.doc.sliceString(currentFrom, currentTo);

      useSourceFormatStore.getState().openPopup({
        anchorRect: rect,
        selectedText,
        editorView: update.view,
      });
    }, SHOW_DELAY);
  } else {
    // No selection - close popup (table popup is triggered by shortcut)
    clearShowTimeout();
    useSourceFormatStore.getState().closePopup();
  }
});

// Re-export from contextDetection
export { triggerFormatPopup, toggleTablePopup } from "./contextDetection";

// Re-export components
export { SourceFormatPopup } from "./SourceFormatPopup";
export { applyFormat, hasFormat, type FormatType } from "./formatActions";
