/**
 * Structural Character Detection
 *
 * Purpose: Pattern constants and cursor-position probes for structural
 * markdown characters (table pipes, list/task markers, blockquote markers),
 * shared by the protection keymap and other list/table plugins.
 *
 * Key decisions:
 *   - Escaped pipes (\|) and pipes inside inline code spans are cell content,
 *     not delimiters
 *   - Every probe has a state+position variant (usable per cursor for
 *     multi-cursor) plus a view-based wrapper reading the main selection
 *
 * @coordinates-with structuralCharProtection.ts — consumes these probes
 * @coordinates-with listSmartIndent.ts — reuses LIST_ITEM_PATTERN, TASK_ITEM_PATTERN
 * @module plugins/codemirror/structuralCharDetection
 */

import { type EditorView } from "@codemirror/view";
import { type EditorState } from "@codemirror/state";
import { isPipeInCodeSpan } from "@/utils/tableParser";

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
 * Check if a pipe is escaped — preceded by an odd number of backslashes.
 * `\|` is escaped (cell content); `\\|` is a literal backslash + delimiter.
 */
export function isPipeEscaped(text: string, pipeIndex: number): boolean {
  let n = 0;
  let i = pipeIndex - 1;
  while (i >= 0 && text[i] === "\\") {
    n++;
    i--;
  }
  return n % 2 === 1;
}

/**
 * Check if a position is right after a table pipe at cell start.
 * Returns the pipe position if true, or -1 if not.
 */
export function getCellStartPipePosAt(state: EditorState, head: number): number {
  const line = state.doc.lineAt(head);

  // Not in a table row
  if (!TABLE_ROW_PATTERN.test(line.text)) return -1;

  // Find pipes in the line
  const offsetInLine = head - line.from;
  const textBefore = line.text.slice(0, offsetInLine);

  // Walk back through trailing whitespace, find nearest `|`, and check that
  // it's a real delimiter — not an escaped pipe (`\|`) and not a pipe inside
  // an inline code span (`` `a|b` ``).
  let i = textBefore.length - 1;
  while (i >= 0 && /\s/.test(textBefore[i])) i--;
  if (
    i >= 0 &&
    textBefore[i] === "|" &&
    !isPipeEscaped(textBefore, i) &&
    !isPipeInCodeSpan(textBefore, i)
  ) {
    return line.from + i;
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
export function getListMarkerRangeAt(
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
export function getTaskMarkerRangeAt(
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
export function getBlockquoteMarkerInfoAt(
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
