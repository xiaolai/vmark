/**
 * Source Selection Actions
 *
 * Purpose: Selection expansion commands for source mode — select word, line, block,
 * or progressively expand selection. Used by the toolbar's selection submenu.
 *
 * @coordinates-with sourceSelection.ts — provides range computation utilities
 * @coordinates-with sourceAdapter.ts — routes "selectWord"/"selectLine"/etc. here
 * @module plugins/toolbarActions/sourceSelectionActions
 */
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  getSourceBlockRange,
  getSourceExpandedRange,
  getSourceLineRange,
  getSourceSelectionRange,
  getSourceWordRange,
} from "@/utils/sourceSelection";

function applySelectionRange(view: EditorView, range: { from: number; to: number } | null): boolean {
  if (!range) return false;
  view.dispatch({ selection: EditorSelection.range(range.from, range.to) });
  view.focus();
  return true;
}

export function selectWordInSource(view: EditorView): boolean {
  const pos = view.state.selection.main.from;
  return applySelectionRange(view, getSourceWordRange(view.state, pos));
}

export function selectLineInSource(view: EditorView): boolean {
  const pos = view.state.selection.main.from;
  return applySelectionRange(view, getSourceLineRange(view.state, pos));
}

export function selectBlockInSource(view: EditorView): boolean {
  const selection = getSourceSelectionRange(view.state);
  const range = getSourceBlockRange(view.state, selection.from, selection.to);
  return applySelectionRange(view, range);
}

export function expandSelectionInSource(view: EditorView): boolean {
  const selection = getSourceSelectionRange(view.state);
  const expanded = getSourceExpandedRange(view.state, selection.from, selection.to);
  return applySelectionRange(view, expanded);
}
