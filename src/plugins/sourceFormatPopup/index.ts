/**
 * Source Format Popup Extension for CodeMirror
 *
 * Detects text selection and shows/hides the formatting popup.
 * Also detects when cursor is in a table to show table operations.
 * Uses debounce to avoid flicker during rapid selection changes.
 */

import { EditorView } from "@codemirror/view";
import { useSourceFormatStore } from "@/stores/sourceFormatStore";
import { getSourceTableInfo } from "./tableDetection";
import { getHeadingInfo } from "./headingDetection";

// Debounce timeout for showing popup
let showTimeout: ReturnType<typeof setTimeout> | null = null;

// Minimum selection length to show popup
const MIN_SELECTION_LENGTH = 1;

// Delay before showing popup (ms)
const SHOW_DELAY = 200;

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
 * Get the bounding rect for a selection range.
 */
function getSelectionRect(view: EditorView, from: number, to: number) {
  const fromCoords = view.coordsAtPos(from);
  const toCoords = view.coordsAtPos(to);

  if (!fromCoords || !toCoords) return null;

  return {
    top: Math.min(fromCoords.top, toCoords.top),
    left: Math.min(fromCoords.left, toCoords.left),
    bottom: Math.max(fromCoords.bottom, toCoords.bottom),
    right: Math.max(fromCoords.right, toCoords.right),
  };
}

/**
 * Get the bounding rect for current cursor position.
 */
function getCursorRect(view: EditorView, pos: number) {
  const coords = view.coordsAtPos(pos);
  if (!coords) return null;

  return {
    top: coords.top,
    left: coords.left,
    bottom: coords.bottom,
    right: coords.right,
  };
}

/**
 * CodeMirror extension that monitors selection and manages popup visibility.
 */
export const sourceFormatExtension = EditorView.updateListener.of((update) => {
  // Only handle selection changes
  if (!update.selectionSet) return;

  const { from, to } = update.view.state.selection.main;
  const hasSelection = to - from >= MIN_SELECTION_LENGTH;

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
        // No selection - check for table
        checkTableContext(update.view);
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
    // No selection - check if cursor is in a table
    clearShowTimeout();
    checkTableContext(update.view);
  }
});

/**
 * Check if cursor is in a table and show table popup if so.
 */
function checkTableContext(view: EditorView) {
  const tableInfo = getSourceTableInfo(view);

  if (tableInfo) {
    // Cursor is in a table - show table popup
    const { from } = view.state.selection.main;
    const rect = getCursorRect(view, from);
    if (!rect) {
      useSourceFormatStore.getState().closePopup();
      return;
    }

    useSourceFormatStore.getState().openTablePopup({
      anchorRect: rect,
      editorView: view,
      tableInfo,
    });
  } else {
    // Not in table - close popup
    useSourceFormatStore.getState().closePopup();
  }
}

// Re-export components
export { SourceFormatPopup } from "./SourceFormatPopup";
export { applyFormat, hasFormat, type FormatType } from "./formatActions";
