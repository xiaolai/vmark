/**
 * Structural Character Protection
 *
 * Purpose: Prevents accidental deletion of structural markdown characters (table pipes,
 * list markers, blockquote markers) by intercepting Backspace/Delete at those positions.
 *
 * Key decisions:
 *   - Backspace at a table pipe skips over it (moves cursor) instead of deleting
 *   - Backspace at a list marker removes the entire marker (semantic operation)
 *   - Blockquote markers (>) are protected at the start of lines
 *   - Pattern constants are exported for reuse by other plugins (e.g., listSmartIndent)
 *
 * @coordinates-with listSmartIndent.ts — reuses LIST_ITEM_PATTERN, TASK_ITEM_PATTERN
 * @coordinates-with tableTabNav.ts — both operate on table structure
 * @module plugins/codemirror/structuralCharProtection
 */

import { type KeyBinding, type EditorView } from "@codemirror/view";
import { EditorState, EditorSelection, type ChangeSpec, type SelectionRange } from "@codemirror/state";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";

/**
 * Patterns for detecting structural characters at cursor position.
 * Exported for testing.
 */

// Table row: starts with optional whitespace, then pipe
export const TABLE_ROW_PATTERN = /^\s*\|/;

// List item: starts with optional whitespace, then marker
export const LIST_ITEM_PATTERN = /^(\s*)(-|\*|\+|\d+\.)\s/;

// Task list item: starts with optional whitespace, then marker + checkbox
export const TASK_ITEM_PATTERN = /^(\s*)([-*+])\s\[([ xX])\]\s/;

// Blockquote: starts with optional whitespace, then >
export const BLOCKQUOTE_PATTERN = /^(\s*)(>+)\s?/;

/**
 * Check if a position is right after a table pipe at cell start.
 * Returns the pipe position if true, or -1 if not.
 */
function getCellStartPipePosAt(state: EditorState, head: number): number {
  const line = state.doc.lineAt(head);

  // Not in a table row
  if (!TABLE_ROW_PATTERN.test(line.text)) return -1;

  // Find pipes in the line
  const offsetInLine = head - line.from;
  const textBefore = line.text.slice(0, offsetInLine);

  // Check if we're right after a pipe (with only whitespace between).
  // Negative lookbehind excludes escaped pipes (\|) which are cell content, not delimiters.
  const match = textBefore.match(/(?<!\\)\|\s*$/);
  if (match) {
    return line.from + textBefore.length - match[0].length;
  }

  return -1;
}

/**
 * Check if cursor is right after a table pipe at cell start.
 * Returns the pipe position if true, or -1 if not.
 * Exported for testing.
 */
export function getCellStartPipePos(view: EditorView): number {
  return getCellStartPipePosAt(view.state, view.state.selection.main.head);
}

/**
 * Check if a position is right after a list marker.
 * Returns the marker range if true, or null if not.
 */
function getListMarkerRangeAt(
  state: EditorState, head: number
): { from: number; to: number; indent: number } | null {
  const line = state.doc.lineAt(head);
  const offsetInLine = head - line.from;

  const match = line.text.match(LIST_ITEM_PATTERN);
  if (!match) return null;

  const markerEnd = match[0].length;
  const indent = match[1].length;

  // Cursor must be right after the marker (including space)
  if (offsetInLine <= markerEnd && offsetInLine > indent) {
    return {
      from: line.from + indent,
      to: line.from + markerEnd,
      indent,
    };
  }

  return null;
}

/**
 * Check if cursor is right after a list marker.
 * Exported for testing.
 */
export function getListMarkerRange(
  view: EditorView
): { from: number; to: number; indent: number } | null {
  return getListMarkerRangeAt(view.state, view.state.selection.main.head);
}

/**
 * Check if a position is right after a task list marker.
 * Returns the marker range and indent if true, or null if not.
 */
function getTaskMarkerRangeAt(
  state: EditorState, head: number
): { from: number; to: number; indent: number } | null {
  const line = state.doc.lineAt(head);
  const offsetInLine = head - line.from;

  const match = line.text.match(TASK_ITEM_PATTERN);
  if (!match) return null;

  const markerEnd = match[0].length;
  const indent = match[1].length;

  // Cursor must be right after the marker (including space after checkbox)
  if (offsetInLine <= markerEnd && offsetInLine > indent) {
    return {
      from: line.from + indent,
      to: line.from + markerEnd,
      indent,
    };
  }

  return null;
}

/**
 * Check if cursor is right after a task list marker.
 * Exported for testing.
 */
export function getTaskMarkerRange(
  view: EditorView
): { from: number; to: number; indent: number } | null {
  return getTaskMarkerRangeAt(view.state, view.state.selection.main.head);
}

/**
 * Check if a position is right after a blockquote marker.
 * Returns the marker position info if true, or null if not.
 */
function getBlockquoteMarkerInfoAt(
  state: EditorState, head: number
): { markerEnd: number; depth: number } | null {
  const line = state.doc.lineAt(head);
  const offsetInLine = head - line.from;

  const match = line.text.match(BLOCKQUOTE_PATTERN);
  if (!match) return null;

  const markerEnd = match[0].length;

  // Cursor must be within or right after the marker area
  if (offsetInLine <= markerEnd && offsetInLine > match[1].length) {
    return {
      markerEnd: line.from + markerEnd,
      depth: match[2].length, // Number of > characters
    };
  }

  return null;
}

/**
 * Check if cursor is right after a blockquote marker.
 * Exported for testing.
 */
export function getBlockquoteMarkerInfo(view: EditorView): { markerEnd: number; depth: number } | null {
  return getBlockquoteMarkerInfoAt(view.state, view.state.selection.main.head);
}

/**
 * Compute backspace change for a list/task marker: outdent if indented, remove at level 0.
 * Returns { changes, range } for use with changeByRange.
 */
function backspaceMarkerSpec(
  state: EditorState,
  head: number,
  marker: { from: number; to: number; indent: number }
): { changes: ChangeSpec; range: SelectionRange } {
  if (marker.indent > 0) {
    const line = state.doc.lineAt(head);
    const tabSize = state.facet(EditorState.tabSize);
    const removeCount = Math.min(marker.indent, tabSize);
    return {
      changes: { from: line.from, to: line.from + removeCount },
      range: EditorSelection.cursor(head - removeCount),
    };
  }
  return {
    changes: { from: marker.from, to: marker.to },
    range: EditorSelection.cursor(marker.from),
  };
}

/**
 * Compute backspace change for a blockquote marker.
 * Returns { changes, range } for use with changeByRange.
 */
function backspaceBlockquoteSpec(
  state: EditorState,
  head: number,
  info: { markerEnd: number; depth: number }
): { changes: ChangeSpec; range: SelectionRange } | null {
  const line = state.doc.lineAt(head);
  const match = line.text.match(BLOCKQUOTE_PATTERN);
  /* v8 ignore next -- @preserve else branch: match always succeeds when getBlockquoteMarkerInfo returns non-null */
  if (!match) return null;

  if (info.depth > 1) {
    const newText = match[1] + ">".repeat(info.depth - 1) + " ";
    return {
      changes: { from: line.from, to: line.from + match[0].length, insert: newText },
      range: EditorSelection.cursor(line.from + newText.length),
    };
  }
  return {
    changes: { from: line.from, to: line.from + match[0].length },
    range: EditorSelection.cursor(line.from),
  };
}

/**
 * Compute the backspace change spec for a single cursor position.
 * Returns null if the position is not at a structural character.
 */
function backspaceSpecForCursor(
  state: EditorState, head: number
): { changes: ChangeSpec; range: SelectionRange } | null {
  const pipePos = getCellStartPipePosAt(state, head);
  if (pipePos >= 0) {
    return { changes: [], range: EditorSelection.cursor(pipePos) };
  }

  const taskMarker = getTaskMarkerRangeAt(state, head);
  if (taskMarker) return backspaceMarkerSpec(state, head, taskMarker);

  const listMarker = getListMarkerRangeAt(state, head);
  if (listMarker) return backspaceMarkerSpec(state, head, listMarker);

  const bqInfo = getBlockquoteMarkerInfoAt(state, head);
  if (bqInfo) return backspaceBlockquoteSpec(state, head, bqInfo);

  return null;
}

/**
 * Smart backspace handler that protects structural characters.
 * Processes each cursor independently for multi-cursor support.
 * Exported for testing.
 */
export function smartBackspace(view: EditorView): boolean {
  const { state } = view;
  const { ranges } = state.selection;

  // Only handle when all cursors are empty (no text selection)
  if (ranges.some(r => !r.empty)) return false;

  // Check if any cursor is at a structural position
  let anyStructural = false;
  for (const range of ranges) {
    if (range.head > 0 && backspaceSpecForCursor(state, range.head)) {
      anyStructural = true;
      break;
    }
  }
  if (!anyStructural) return false;

  view.dispatch(
    state.changeByRange(range => {
      const { head } = range;
      if (head === 0) return { range };

      const spec = backspaceSpecForCursor(state, head);
      if (spec) return spec;

      // Non-structural cursor: apply default single-char backspace
      return {
        changes: { from: head - 1, to: head },
        range: EditorSelection.cursor(head - 1),
      };
    }),
    { scrollIntoView: true }
  );

  return true;
}

/**
 * Compute the delete change spec for a single cursor position.
 * Returns null if the position is not at a structural character.
 */
function deleteSpecForCursor(
  state: EditorState, head: number
): { changes: ChangeSpec; range: SelectionRange } | null {
  if (head >= state.doc.length) return null;

  const line = state.doc.lineAt(head);
  const offsetInLine = head - line.from;

  // Check if we're about to delete into a pipe
  const charAfter = line.text[offsetInLine];
  if (charAfter === "|" && TABLE_ROW_PATTERN.test(line.text)) {
    // Don't protect escaped pipes (\|) — they are cell content, not delimiters
    if (offsetInLine > 0 && line.text[offsetInLine - 1] === "\\") return null;
    return { changes: [], range: EditorSelection.cursor(head + 1) };
  }

  // At end of line, forward-deleting would merge with next line —
  // protect structural markers on the next line by skipping over them
  if (head === line.to && line.number < state.doc.lines) {
    const nextLine = state.doc.line(line.number + 1);

    if (TABLE_ROW_PATTERN.test(nextLine.text)) {
      return { changes: [], range: EditorSelection.cursor(nextLine.from) };
    }

    const taskMatch = nextLine.text.match(TASK_ITEM_PATTERN);
    if (taskMatch) {
      return { changes: [], range: EditorSelection.cursor(nextLine.from + taskMatch[0].length) };
    }

    const listMatch = nextLine.text.match(LIST_ITEM_PATTERN);
    if (listMatch) {
      return { changes: [], range: EditorSelection.cursor(nextLine.from + listMatch[0].length) };
    }

    const blockquoteMatch = nextLine.text.match(BLOCKQUOTE_PATTERN);
    if (blockquoteMatch) {
      return { changes: [], range: EditorSelection.cursor(nextLine.from + blockquoteMatch[0].length) };
    }
  }

  return null;
}

/**
 * Smart delete handler that protects structural characters.
 * Processes each cursor independently for multi-cursor support.
 * Exported for testing.
 */
export function smartDelete(view: EditorView): boolean {
  const { state } = view;
  const { ranges } = state.selection;

  // Only handle when all cursors are empty (no text selection)
  if (ranges.some(r => !r.empty)) return false;

  // Check if any cursor is at a structural position
  let anyStructural = false;
  for (const range of ranges) {
    if (deleteSpecForCursor(state, range.head)) {
      anyStructural = true;
      break;
    }
  }
  if (!anyStructural) return false;

  view.dispatch(
    state.changeByRange(range => {
      const { head } = range;

      const spec = deleteSpecForCursor(state, head);
      if (spec) return spec;

      // Non-structural cursor: apply default single-char delete
      if (head >= state.doc.length) return { range };
      return {
        changes: { from: head, to: head + 1 },
        range: EditorSelection.cursor(head),
      };
    }),
    { scrollIntoView: true }
  );

  return true;
}

/**
 * Keybinding for protected backspace.
 */
export const structuralBackspaceKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Backspace",
  run: smartBackspace,
});

/**
 * Keybinding for protected delete.
 */
export const structuralDeleteKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Delete",
  run: smartDelete,
});
