/**
 * Source Adapter Helpers
 *
 * Low-level helper functions for source mode toolbar actions.
 * Used by sourceAdapter.ts for text insertion and formatting.
 */

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { applyFormat, type FormatType } from "@/plugins/sourceFormatPopup";
import { clearAllFormatting } from "@/plugins/sourceFormatPopup/clearFormatting";
import { applyInlineFormatToSelections } from "@/plugins/sourceFormatPopup/formatMultiSelection";

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
 * Returns false if no selection or format not applicable.
 */
export function applyInlineFormat(view: EditorView, format: FormatType): boolean {
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
