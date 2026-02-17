/**
 * Source Text Transforms
 *
 * Line operations and text case transformations for source (CodeMirror) mode.
 * Extracted from sourceAdapter.ts to keep files under ~300 lines.
 *
 * @coordinates-with sourceAdapter.ts — main dispatcher imports these handlers
 * @module plugins/toolbarActions/sourceTextTransforms
 */

import type { EditorView } from "@codemirror/view";
import {
  toUpperCase,
  toLowerCase,
  toTitleCase,
  toggleCase,
  removeBlankLines,
  moveLinesUp,
  moveLinesDown,
  duplicateLines,
  deleteLines,
  joinLines,
  sortLinesAscending,
  sortLinesDescending,
} from "@/utils/textTransformations";

// --- Line operations ---

export function handleMoveLineUp(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const result = moveLinesUp(text, from, to);

  if (!result) return false;

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newFrom, head: result.newTo },
  });
  view.focus();
  return true;
}

export function handleMoveLineDown(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const result = moveLinesDown(text, from, to);

  if (!result) return false;

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newFrom, head: result.newTo },
  });
  view.focus();
  return true;
}

export function handleDuplicateLine(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const result = duplicateLines(text, from, to);

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newFrom, head: result.newTo },
  });
  view.focus();
  return true;
}

export function handleDeleteLine(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const result = deleteLines(text, from, to);

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newCursor },
  });
  view.focus();
  return true;
}

export function handleJoinLines(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const result = joinLines(text, from, to);

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newFrom, head: result.newTo },
  });
  view.focus();
  return true;
}

export function handleSortLinesAsc(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const result = sortLinesAscending(text, from, to);

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newFrom, head: result.newTo },
  });
  view.focus();
  return true;
}

export function handleSortLinesDesc(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const result = sortLinesDescending(text, from, to);

  view.dispatch({
    changes: { from: 0, to: text.length, insert: result.newText },
    selection: { anchor: result.newFrom, head: result.newTo },
  });
  view.focus();
  return true;
}

export function handleRemoveBlankLines(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;

  if (from === to) {
    return false; // No selection
  }

  const selectedText = view.state.doc.sliceString(from, to);
  const transformed = removeBlankLines(selectedText);

  if (transformed === selectedText) {
    return true; // No change needed
  }

  view.dispatch({
    changes: { from, to, insert: transformed },
    selection: { anchor: from, head: from + transformed.length },
  });
  view.focus();
  return true;
}

// --- Text transformations ---

export function handleTransformCase(view: EditorView, transform: (text: string) => string): boolean {
  const { from, to } = view.state.selection.main;

  if (from === to) {
    return false; // No selection
  }

  const selectedText = view.state.doc.sliceString(from, to);
  const transformed = transform(selectedText);

  if (transformed === selectedText) {
    return true; // No change needed
  }

  view.dispatch({
    changes: { from, to, insert: transformed },
    selection: { anchor: from, head: from + transformed.length },
  });
  view.focus();
  return true;
}

// Re-export transform functions for use in the dispatcher switch
export { toUpperCase, toLowerCase, toTitleCase, toggleCase };
