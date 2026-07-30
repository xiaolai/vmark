/**
 * WYSIWYG Adapter - Line Operations
 *
 * Purpose: the ProseMirror equivalents of Source mode's line operations — move
 * up/down, duplicate, delete, join, and remove blank lines.
 *
 * Key decisions:
 *   - The target is the LINE UNIT at the cursor, resolved by `wysiwygLineUnit`,
 *     not the top-level block. Hardcoding the top-level block is what made
 *     `deleteLine` in a table cell delete the entire table.
 *   - A deletion widens outward past ancestors it would leave empty, so removing
 *     the only item of a list removes the list rather than leaving a bare `-`.
 *   - Row moves refuse to displace a table's header, because markdown's
 *     delimiter row must stay directly beneath it.
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher delegates line operations here
 * @coordinates-with wysiwygLineUnit.ts — resolves which node is "the line"
 * @coordinates-with sourceAdapter.ts — the line-oriented surface this mirrors
 * @module plugins/toolbarActions/wysiwygAdapterBlockOps
 */
import { Selection } from "@tiptap/pm/state";
import type { WysiwygToolbarContext } from "./types";
import { collapseEmptyAncestors, isTableHeaderRow, lineUnitDepth } from "./wysiwygLineUnit";

/**
 * Move the line unit at the cursor up (swap with its previous sibling).
 */
export function handleWysiwygMoveBlockUp(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { $from } = state.selection;

  // Find current block's position in doc
  const blockDepth = lineUnitDepth($from);
  if (blockDepth === 0) return false;

  const blockIndex = $from.index(blockDepth - 1);

  if (blockIndex === 0) return false; // Already at top

  // Get parent and swap with previous sibling
  const parent = $from.node(blockDepth - 1);
  if (isTableHeaderRow(parent, blockIndex - 1)) return false; // never displace the header
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

  const blockDepth = lineUnitDepth($from);
  if (blockDepth === 0) return false;

  const blockIndex = $from.index(blockDepth - 1);
  const parent = $from.node(blockDepth - 1);

  if (blockIndex >= parent.childCount - 1) return false; // Already at bottom
  if (isTableHeaderRow(parent, blockIndex)) return false; // the header stays first

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

  const blockDepth = lineUnitDepth($from);
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

  const blockDepth = lineUnitDepth($from);
  if (blockDepth === 0) return false;

  const deleteDepth = collapseEmptyAncestors($from, blockDepth);
  const blockStart = $from.before(deleteDepth);
  const blockEnd = $from.after(deleteDepth);

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
    /* v8 ignore next -- @preserve reason: container block nodes in delete-empty not tested */
    if (node.isBlock && !node.isTextblock) {
      // Skip container nodes like lists, blockquotes
      return true;
    }

    /* v8 ignore next -- @preserve reason: non-textblock non-container nodes (e.g., images) in delete-empty not tested */
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
