/**
 * Paste Utilities
 *
 * Purpose: Shared helper functions for paste-related plugins to detect selection
 * context and determine whether paste handlers should process content.
 *
 * Key decisions:
 *   - Code block/mark detection causes paste handlers to pass through
 *     (code blocks receive raw text, not parsed markdown)
 *   - Multi-selection detection delegates to multi-cursor plugin
 *   - EditorView wrappers provided for convenience (many paste handlers receive view)
 *
 * @coordinates-with smartPaste/tiptap.ts — uses isSelectionInCode to skip smart paste
 * @coordinates-with htmlPaste/tiptap.ts — uses isSelectionInCodeBlock to skip HTML paste
 * @coordinates-with multiCursor/clipboard.ts — handles multi-cursor paste separately
 * @module utils/pasteUtils
 */

import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Check if selection spans multiple cursors.
 * Multi-cursor paste needs special handling by the multi-cursor plugin.
 */
export function isMultiSelection(state: EditorState): boolean {
  return state.selection.ranges.length > 1;
}

/**
 * Check if selection is inside a code block node.
 * Paste handlers should typically pass through when in code blocks.
 */
export function isSelectionInCodeBlock(state: EditorState): boolean {
  const { selection, schema } = state;
  const codeBlock = schema.nodes.codeBlock;

  if (!codeBlock) return false;

  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    if (selection.$from.node(depth).type === codeBlock) return true;
  }
  for (let depth = selection.$to.depth; depth > 0; depth -= 1) {
    if (selection.$to.node(depth).type === codeBlock) return true;
  }

  return false;
}

/**
 * Check if selection is inside a code block or has code mark applied.
 * More comprehensive than isSelectionInCodeBlock - also checks inline code.
 */
export function isSelectionInCode(state: EditorState): boolean {
  const { selection, schema, storedMarks } = state;
  const codeMark = schema.marks.code;

  // Check code block first
  if (isSelectionInCodeBlock(state)) return true;

  // Check for code mark
  if (!codeMark) return false;

  const fromMarks = selection.$from.marks();
  const toMarks = selection.$to.marks();
  if (codeMark.isInSet(fromMarks) || codeMark.isInSet(toMarks)) return true;
  if (storedMarks && codeMark.isInSet(storedMarks)) return true;

  return false;
}

/**
 * EditorView-based version of isSelectionInCodeBlock.
 * Convenience wrapper when you have a view instead of state.
 */
export function isViewSelectionInCodeBlock(view: EditorView): boolean {
  return isSelectionInCodeBlock(view.state);
}

/**
 * EditorView-based version of isSelectionInCode.
 * Convenience wrapper when you have a view instead of state.
 */
export function isViewSelectionInCode(view: EditorView): boolean {
  return isSelectionInCode(view.state);
}

/**
 * EditorView-based version of isMultiSelection.
 * Convenience wrapper when you have a view instead of state.
 */
export function isViewMultiSelection(view: EditorView): boolean {
  return isMultiSelection(view.state);
}
