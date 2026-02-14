/**
 * WYSIWYG Adapter - Block Operations
 *
 * Purpose: Block-level editing operations for WYSIWYG mode — the ProseMirror
 * equivalents of source-mode line operations. Includes move up/down, duplicate,
 * delete, join, and remove blank lines.
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher delegates block operations here
 * @coordinates-with sourceAdapter.ts — parallel line operations for Source mode
 * @module plugins/toolbarActions/wysiwygAdapterBlockOps
 */
import { Selection } from "@tiptap/pm/state";
import type { WysiwygToolbarContext } from "./types";

/**
 * Move the current top-level block up (swap with previous sibling).
 */
export function handleWysiwygMoveBlockUp(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { $from } = state.selection;

  // Find current block's position in doc
  const blockDepth = $from.depth > 0 ? 1 : 0;
  if (blockDepth === 0) return false;

  const blockIndex = $from.index(blockDepth - 1);

  if (blockIndex === 0) return false; // Already at top

  // Get parent and swap with previous sibling
  const parent = $from.node(blockDepth - 1);
  const prevBlock = parent.child(blockIndex - 1);
  const currentBlock = parent.child(blockIndex);

  const tr = state.tr;

  // Calculate positions
  const pos = $from.before(blockDepth);
  const prevStart = pos - prevBlock.nodeSize;

  // Delete current block and insert before prev
  tr.delete(pos, pos + currentBlock.nodeSize);
  tr.insert(prevStart, currentBlock);

  // Update selection to stay with the moved block
  const newPos = prevStart + 1;
  tr.setSelection(Selection.near(tr.doc.resolve(newPos)));

  dispatch(tr);
  editor.commands.focus();
  return true;
}

/**
 * Move the current top-level block down (swap with next sibling).
 */
export function handleWysiwygMoveBlockDown(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { $from } = state.selection;

  const blockDepth = $from.depth > 0 ? 1 : 0;
  if (blockDepth === 0) return false;

  const blockIndex = $from.index(blockDepth - 1);
  const parent = $from.node(blockDepth - 1);

  if (blockIndex >= parent.childCount - 1) return false; // Already at bottom

  const currentBlock = parent.child(blockIndex);
  const nextBlock = parent.child(blockIndex + 1);

  const tr = state.tr;

  // Calculate positions
  const pos = $from.before(blockDepth);
  const nextEnd = pos + currentBlock.nodeSize + nextBlock.nodeSize;

  // Delete next block and insert before current
  const nextStart = pos + currentBlock.nodeSize;
  tr.delete(nextStart, nextEnd);
  tr.insert(pos, nextBlock);

  // Update selection to stay with the moved block
  const newPos = pos + nextBlock.nodeSize + 1;
  tr.setSelection(Selection.near(tr.doc.resolve(newPos)));

  dispatch(tr);
  editor.commands.focus();
  return true;
}

/**
 * Duplicate the current top-level block immediately after itself.
 */
export function handleWysiwygDuplicateBlock(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { $from } = state.selection;

  const blockDepth = $from.depth > 0 ? 1 : 0;
  if (blockDepth === 0) return false;

  const blockIndex = $from.index(blockDepth - 1);
  const parent = $from.node(blockDepth - 1);
  const currentBlock = parent.child(blockIndex);

  const tr = state.tr;
  const blockEnd = $from.after(blockDepth);

  // Insert copy after current block
  tr.insert(blockEnd, currentBlock.copy(currentBlock.content));

  // Move selection to duplicated block
  const newPos = blockEnd + 1;
  tr.setSelection(Selection.near(tr.doc.resolve(newPos)));

  dispatch(tr);
  editor.commands.focus();
  return true;
}

/**
 * Delete the current top-level block.
 */
export function handleWysiwygDeleteBlock(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { $from } = state.selection;

  const blockDepth = $from.depth > 0 ? 1 : 0;
  if (blockDepth === 0) return false;

  const blockStart = $from.before(blockDepth);
  const blockEnd = $from.after(blockDepth);

  const tr = state.tr;
  tr.delete(blockStart, blockEnd);

  // Position cursor at start of next block or end of document
  const newPos = Math.min(blockStart, tr.doc.content.size);
  if (newPos > 0) {
    tr.setSelection(Selection.near(tr.doc.resolve(newPos)));
  }

  dispatch(tr);
  editor.commands.focus();
  return true;
}

/**
 * Join the current block with the previous one (Tiptap's joinBackward).
 */
export function handleWysiwygJoinBlocks(context: WysiwygToolbarContext): boolean {
  const { editor } = context;
  if (!editor) return false;

  // Use TipTap's built-in join command
  return editor.commands.joinBackward();
}

/**
 * Remove empty/whitespace-only blocks within the selection.
 * Only deletes blocks fully contained within the selection range.
 */
export function handleWysiwygRemoveBlankLines(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { from, to, empty } = state.selection;

  if (empty) return false; // No selection

  // Find empty block nodes within selection and delete them
  // Empty blocks: paragraphs with no content, empty list items, etc.
  const tr = state.tr;
  const nodesToDelete: { from: number; to: number }[] = [];

  state.doc.nodesBetween(from, to, (node, pos) => {
    // Check if this is a block node that's "empty" (no text content)
    if (node.isBlock && !node.isTextblock) {
      // Skip container nodes like lists, blockquotes
      return true;
    }

    if (node.isTextblock) {
      // Check if the block is empty or contains only whitespace
      const text = node.textContent;
      if (text.trim() === "") {
        // Only delete if fully within selection
        const nodeEnd = pos + node.nodeSize;
        if (pos >= from && nodeEnd <= to) {
          nodesToDelete.push({ from: pos, to: nodeEnd });
        }
      }
    }
    return true;
  });

  if (nodesToDelete.length === 0) return true; // Nothing to remove

  // Delete in reverse order to preserve positions
  for (let i = nodesToDelete.length - 1; i >= 0; i--) {
    const { from: delFrom, to: delTo } = nodesToDelete[i];
    tr.delete(tr.mapping.map(delFrom), tr.mapping.map(delTo));
  }

  dispatch(tr);
  editor.commands.focus();
  return true;
}
