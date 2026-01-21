/**
 * Source Adapter Helpers
 *
 * Low-level helper functions for source mode toolbar actions.
 * Used by sourceAdapter.ts for text insertion and formatting.
 */

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { applyFormat, type FormatType } from "@/plugins/sourceContextDetection";
import { clearAllFormatting } from "@/plugins/sourceContextDetection/clearFormatting";
import { applyInlineFormatToSelections } from "@/plugins/sourceContextDetection/formatMultiSelection";
import { FORMAT_MARKERS, type WrapFormatType } from "@/plugins/sourceContextDetection/formatTypes";
import { findWordBoundaries } from "@/utils/wordSegmentation";

/**
 * Insert text at the current selection with optional cursor positioning.
 */
export function insertText(view: EditorView, text: string, cursorOffset?: number): void {
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

/**
 * Apply inline format to selection. Handles multi-selection.
 * When no selection, expands to word at cursor (matches WYSIWYG behavior).
 * Returns false if format not applicable.
 */
export function applyInlineFormat(view: EditorView, format: FormatType): boolean {
  const { selection } = view.state;
  if (selection.ranges.length > 1) {
    if (format === "footnote" || format === "image" || format === "link") return false;
    return applyInlineFormatToSelections(view, format);
  }

  const { from, to } = selection.main;

  // No selection: expand to word at cursor
  if (from === to) {
    // Skip formats that don't make sense for word-at-cursor
    if (format === "footnote" || format === "image" || format === "link") return false;

    const wordRange = findWordAtCursorSource(view, from);
    if (!wordRange) return false;

    // Apply format to word range, then restore cursor
    applyFormatToRange(view, format, wordRange.from, wordRange.to, from);
    return true;
  }

  applyFormat(view, format);
  return true;
}

/**
 * Find word boundaries at cursor position in CodeMirror.
 * Returns document positions for the word containing the cursor.
 */
function findWordAtCursorSource(
  view: EditorView,
  pos: number
): { from: number; to: number } | null {
  const line = view.state.doc.lineAt(pos);
  const lineText = line.text;
  const offsetInLine = pos - line.from;

  const boundaries = findWordBoundaries(lineText, offsetInLine);
  if (!boundaries) return null;

  return {
    from: line.from + boundaries.start,
    to: line.from + boundaries.end,
  };
}

/**
 * Apply format to a specific range, then restore cursor to original position.
 * Handles both wrapping (add markers) and unwrapping (remove markers).
 */
function applyFormatToRange(
  view: EditorView,
  format: FormatType,
  wordFrom: number,
  wordTo: number,
  originalCursorPos: number
): void {
  const markers = FORMAT_MARKERS[format as WrapFormatType];
  if (!markers) return;

  const { prefix, suffix } = markers;
  const wordText = view.state.doc.sliceString(wordFrom, wordTo);

  // Calculate cursor offset within the word
  const cursorOffsetInWord = originalCursorPos - wordFrom;

  // Check if word is already wrapped with this format's markers
  const prefixStart = wordFrom - prefix.length;
  const suffixEnd = wordTo + suffix.length;
  const isAlreadyWrapped =
    prefixStart >= 0 &&
    suffixEnd <= view.state.doc.length &&
    view.state.doc.sliceString(prefixStart, wordFrom) === prefix &&
    view.state.doc.sliceString(wordTo, suffixEnd) === suffix;

  if (isAlreadyWrapped) {
    // Unwrap: remove the surrounding markers
    view.dispatch({
      changes: [
        { from: prefixStart, to: wordFrom, insert: "" },
        { from: wordTo, to: suffixEnd, insert: "" },
      ],
    });
    // Cursor position: shift left by prefix length
    const newCursorPos = prefixStart + cursorOffsetInWord;
    view.dispatch({
      selection: { anchor: newCursorPos },
    });
  } else {
    // Wrap: add markers around the word
    const wrapped = prefix + wordText + suffix;
    view.dispatch({
      changes: { from: wordFrom, to: wordTo, insert: wrapped },
    });
    // Cursor position: shift right by prefix length
    const newCursorPos = wordFrom + prefix.length + cursorOffsetInWord;
    view.dispatch({
      selection: { anchor: newCursorPos },
    });
  }

  view.focus();
}

/**
 * Clear formatting across multiple selections.
 * Returns false if single selection or no text selected.
 */
export function clearFormattingSelections(view: EditorView): boolean {
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
