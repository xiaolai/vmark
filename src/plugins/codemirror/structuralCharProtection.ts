/**
 * Structural Character Protection
 *
 * Prevents backspace/delete from accidentally removing structural
 * markdown characters:
 * - Table pipes (|)
 * - List markers (-, *, +, 1.)
 * - Blockquote markers (>)
 *
 * When backspace would delete a structural character, we either:
 * - Skip over it (move cursor without deleting)
 * - Or perform a smarter operation (e.g., move to previous cell)
 */

import { type KeyBinding, type EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
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
 * Check if cursor is right after a table pipe at cell start.
 * Returns the pipe position if true, or -1 if not.
 * Exported for testing.
 */
export function getCellStartPipePos(view: EditorView): number {
  const { state } = view;
  const { head } = state.selection.main;
  const line = state.doc.lineAt(head);

  // Not in a table row
  if (!TABLE_ROW_PATTERN.test(line.text)) return -1;

  // Find pipes in the line
  const offsetInLine = head - line.from;
  const textBefore = line.text.slice(0, offsetInLine);

  // Check if we're right after a pipe (with only whitespace between)
  // Pattern: | followed by optional spaces, cursor here
  const match = textBefore.match(/\|\s*$/);
  if (match) {
    return line.from + textBefore.length - match[0].length;
  }

  return -1;
}

/**
 * Check if cursor is right after a list marker.
 * Returns the marker range if true, or null if not.
 * Exported for testing.
 */
export function getListMarkerRange(
  view: EditorView
): { from: number; to: number; indent: number } | null {
  const { state } = view;
  const { head } = state.selection.main;
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
 * Check if cursor is right after a task list marker.
 * Returns the marker range and indent if true, or null if not.
 * Exported for testing.
 */
export function getTaskMarkerRange(
  view: EditorView
): { from: number; to: number; indent: number } | null {
  const { state } = view;
  const { head } = state.selection.main;
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
 * Check if cursor is right after a blockquote marker.
 * Returns the marker position info if true, or null if not.
 * Exported for testing.
 */
export function getBlockquoteMarkerInfo(view: EditorView): { markerEnd: number; depth: number } | null {
  const { state } = view;
  const { head } = state.selection.main;
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
 * Smart backspace handler that protects structural characters.
 * Exported for testing.
 */
export function smartBackspace(view: EditorView): boolean {
  const { state } = view;
  const { head, empty } = state.selection.main;

  // Only handle when there's no selection
  if (!empty) return false;

  // At document start - nothing to delete
  if (head === 0) return false;

  // Check if we're at a table cell start
  const pipePos = getCellStartPipePos(view);
  if (pipePos >= 0) {
    // Move cursor before the pipe instead of deleting it
    // This allows user to navigate to previous cell
    view.dispatch({
      selection: { anchor: pipePos },
      scrollIntoView: true,
    });
    return true;
  }

  // Check task marker first (more specific pattern, before regular list)
  const taskMarker = getTaskMarkerRange(view);
  if (taskMarker) {
    const line = state.doc.lineAt(head);
    if (taskMarker.indent > 0) {
      // Indented task: outdent by removing leading whitespace
      const tabSize = state.facet(EditorState.tabSize);
      const removeCount = Math.min(taskMarker.indent, tabSize);
      view.dispatch({
        changes: { from: line.from, to: line.from + removeCount },
        scrollIntoView: true,
      });
    } else {
      // Level 0 task: remove the full marker (e.g., "- [ ] ")
      view.dispatch({
        changes: { from: taskMarker.from, to: taskMarker.to },
        scrollIntoView: true,
      });
    }
    return true;
  }

  // Check if we're at a list marker
  const listMarker = getListMarkerRange(view);
  if (listMarker) {
    const line = state.doc.lineAt(head);
    if (listMarker.indent > 0) {
      // Indented list: outdent by removing leading whitespace
      const tabSize = state.facet(EditorState.tabSize);
      const removeCount = Math.min(listMarker.indent, tabSize);
      view.dispatch({
        changes: { from: line.from, to: line.from + removeCount },
        scrollIntoView: true,
      });
    } else {
      // Level 0 list: remove the entire marker
      view.dispatch({
        changes: { from: listMarker.from, to: listMarker.to },
        scrollIntoView: true,
      });
    }
    return true;
  }

  // Check if we're at a blockquote marker
  const blockquoteInfo = getBlockquoteMarkerInfo(view);
  if (blockquoteInfo) {
    const line = state.doc.lineAt(head);
    const match = line.text.match(BLOCKQUOTE_PATTERN);
    if (match) {
      if (blockquoteInfo.depth > 1) {
        // Multiple > characters - remove just one level
        const newText = match[1] + ">".repeat(blockquoteInfo.depth - 1) + " ";
        view.dispatch({
          changes: { from: line.from, to: line.from + match[0].length, insert: newText },
          selection: { anchor: line.from + newText.length },
          scrollIntoView: true,
        });
      } else {
        // Single > - remove the entire marker
        view.dispatch({
          changes: { from: line.from, to: line.from + match[0].length },
          scrollIntoView: true,
        });
      }
      return true;
    }
  }

  // Not at a structural character - let default behavior proceed
  return false;
}

/**
 * Smart delete handler (similar logic for forward delete).
 * Exported for testing.
 */
export function smartDelete(view: EditorView): boolean {
  const { state } = view;
  const { head, empty } = state.selection.main;

  // Only handle when there's no selection
  if (!empty) return false;

  // At document end - nothing to delete
  if (head >= state.doc.length) return false;

  const line = state.doc.lineAt(head);
  const offsetInLine = head - line.from;

  // Check if we're about to delete into a pipe
  const charAfter = line.text[offsetInLine];
  if (charAfter === "|" && TABLE_ROW_PATTERN.test(line.text)) {
    // Skip over the pipe instead of deleting
    view.dispatch({
      selection: { anchor: head + 1 },
      scrollIntoView: true,
    });
    return true;
  }

  return false;
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
