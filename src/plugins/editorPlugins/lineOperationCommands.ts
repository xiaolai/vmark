/**
 * Purpose: Line/block operation shortcut handlers for WYSIWYG mode.
 *
 * Exports:
 * - doWysiwygMoveLineUp / doWysiwygMoveLineDown
 * - doWysiwygDuplicateLine
 * - doWysiwygDeleteLine
 * - doWysiwygJoinLines
 *
 * Key decisions:
 * - "Line" operations operate on the closest block-level node (paragraph, heading, etc.),
 *   not raw text lines, since WYSIWYG mode uses ProseMirror block nodes.
 * - getBlockRange walks up from cursor to find the nearest non-wrapper block.
 *
 * @coordinates-with editorPlugins.tiptap.ts (keymap builder binds these)
 */

import { TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// --- Line operation helpers for WYSIWYG ---

function getBlockRange(state: EditorState): { from: number; to: number; node: ReturnType<typeof state.doc.nodeAt> } | null {
  const { $from } = state.selection;
  // Find the outermost block node containing the cursor
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    // Stop at block-level nodes like paragraph, heading, etc.
    if (node.isBlock && !node.type.name.match(/^(bulletList|orderedList|blockquote|doc)$/)) {
      const from = $from.before(depth);
      const to = $from.after(depth);
      return { from, to, node };
    }
  }
  return null;
}

export function doWysiwygMoveLineUp(view: EditorView): boolean {
  const { state, dispatch } = view;
  const blockRange = getBlockRange(state);
  if (!blockRange) return false;

  // Find the previous sibling block
  const $from = state.doc.resolve(blockRange.from);
  if ($from.index($from.depth - 1) === 0) return false; // Already at top

  const prevBlockStart = $from.before($from.depth) - 1;
  const $prevFrom = state.doc.resolve(prevBlockStart);
  const prevBlock = $prevFrom.nodeBefore;
  if (!prevBlock) return false;

  const prevBlockFrom = prevBlockStart - prevBlock.nodeSize;

  // Swap blocks: delete current, insert before previous
  const currentNode = state.doc.nodeAt(blockRange.from);
  if (!currentNode) return false;

  const tr = state.tr;
  tr.delete(blockRange.from, blockRange.to);
  tr.insert(prevBlockFrom, currentNode);
  // Update selection to moved block
  tr.setSelection(TextSelection.near(tr.doc.resolve(prevBlockFrom + 1)));
  dispatch(tr);
  view.focus();
  return true;
}

export function doWysiwygMoveLineDown(view: EditorView): boolean {
  const { state, dispatch } = view;
  const blockRange = getBlockRange(state);
  if (!blockRange) return false;

  // Find the next sibling block
  const $to = state.doc.resolve(blockRange.to);
  const parentNode = $to.node($to.depth - 1);
  if ($to.index($to.depth - 1) >= parentNode.childCount - 1) return false; // Already at bottom

  const nextBlockEnd = blockRange.to + ($to.nodeAfter?.nodeSize ?? 0);
  const nextBlock = $to.nodeAfter;
  if (!nextBlock) return false;

  // Swap blocks: delete next, insert before current
  const currentNode = state.doc.nodeAt(blockRange.from);
  if (!currentNode) return false;

  const tr = state.tr;
  tr.delete(blockRange.to, nextBlockEnd);
  tr.insert(blockRange.from, nextBlock);
  // Update selection to moved block
  const newPos = blockRange.from + nextBlock.nodeSize;
  tr.setSelection(TextSelection.near(tr.doc.resolve(newPos + 1)));
  dispatch(tr);
  view.focus();
  return true;
}

export function doWysiwygDuplicateLine(view: EditorView): boolean {
  const { state, dispatch } = view;
  const blockRange = getBlockRange(state);
  if (!blockRange) return false;

  const currentNode = state.doc.nodeAt(blockRange.from);
  if (!currentNode) return false;

  // Insert a copy after the current block
  const tr = state.tr.insert(blockRange.to, currentNode.copy(currentNode.content));
  // Move selection to duplicated block
  tr.setSelection(TextSelection.near(tr.doc.resolve(blockRange.to + 1)));
  dispatch(tr);
  view.focus();
  return true;
}

export function doWysiwygDeleteLine(view: EditorView): boolean {
  const { state, dispatch } = view;
  const blockRange = getBlockRange(state);
  if (!blockRange) return false;

  const tr = state.tr.delete(blockRange.from, blockRange.to);
  // Position cursor at the start of where the block was
  const newPos = Math.min(blockRange.from, tr.doc.content.size - 1);
  if (newPos > 0) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(newPos)));
  }
  dispatch(tr);
  view.focus();
  return true;
}

export function doWysiwygJoinLines(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { $from, $to, from, to } = state.selection;

  // If there's a selection spanning multiple blocks, join them
  if (from !== to) {
    const startBlock = $from.blockRange($to);
    if (startBlock && startBlock.depth > 0) {
      // Try to join the blocks
      const tr = state.tr;
      // Replace all newlines/block boundaries with spaces
      const text = state.doc.textBetween(from, to, " ");
      tr.insertText(text, from, to);
      dispatch(tr);
      view.focus();
      return true;
    }
  }

  // No selection: join current block with next
  const blockRange = getBlockRange(state);
  if (!blockRange) return false;

  const $to2 = state.doc.resolve(blockRange.to);
  if (!$to2.nodeAfter) return false;

  const nextNode = $to2.nodeAfter;
  if (!nextNode.isTextblock) return false;

  const nextText = nextNode.textContent.trimStart();

  const tr = state.tr;
  // Delete next block
  tr.delete(blockRange.to, blockRange.to + nextNode.nodeSize);
  // Append next block's text to current block
  const insertPos = blockRange.to - 1;
  tr.insertText(" " + nextText, insertPos, insertPos);
  dispatch(tr);
  view.focus();
  return true;
}
