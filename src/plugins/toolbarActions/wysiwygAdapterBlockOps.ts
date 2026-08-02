/**
 * WYSIWYG Adapter - Line Operations
 *
 * Purpose: the ProseMirror equivalents of Source mode's line operations — move
 * up/down, duplicate, delete, join, and remove blank lines.
 *
 * Key decisions:
 *   - The target is the LINE UNIT at the cursor: an intra-block line when the
 *     textblock holds hardBreak delimiters (`textblockLineAt`), the node
 *     resolved by `wysiwygLineUnit` otherwise. Hardcoding the top-level block
 *     is what made `deleteLine` in a table cell delete the entire table.
 *   - A deletion widens outward past ancestors it would leave empty, so removing
 *     the only item of a list removes the list rather than leaving a bare `-`.
 *   - Row moves refuse to displace a table's header, because markdown's
 *     delimiter row must stay directly beneath it.
 *   - Duplicating a PARAGRAPH inserts a hard break rather than cloning the
 *     node, so the copy is a second line of one block instead of a second
 *     paragraph. Headings and structural units duplicate as siblings — a
 *     heading cannot hold a break, and the copies would run together.
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher delegates line operations here
 * @coordinates-with wysiwygLineUnit.ts — resolves which node/range is "the line"
 * @coordinates-with sourceAdapter.ts — the line-oriented surface this mirrors
 * @module plugins/toolbarActions/wysiwygAdapterBlockOps
 */
import { Fragment } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import type { WysiwygToolbarContext } from "./types";
import {
  collapseEmptyAncestors,
  cutLineRange,
  isTableHeaderRow,
  lineDeletionRange,
  lineUnitDepth,
  swapTextblockLines,
  textblockLineAt,
  withinTable,
} from "./wysiwygLineUnit";

/**
 * Swap the line at the cursor with its neighbour in `direction`.
 *
 * The up and down handlers were mirror-image duplicates; the direction is
 * data, not structure. Inside a hard-break textblock the swap exchanges the
 * two inline line segments around their delimiter; otherwise it swaps the
 * line unit with its sibling block.
 */
function moveLineUnit(context: WysiwygToolbarContext, direction: "up" | "down"): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { $from } = state.selection;

  // A hard-break paragraph is several lines; move only the one at the cursor.
  const line = textblockLineAt($from);
  if (line) {
    const swap = swapTextblockLines($from, line, direction);
    if (!swap) return false; // No neighbouring line inside the block

    const tr = state.tr;
    tr.replaceWith(swap.from, swap.to, swap.fragment);
    tr.setSelection(Selection.near(tr.doc.resolve(swap.cursorPos)));
    dispatch(tr);
    editor.commands.focus();
    return true;
  }

  const blockDepth = lineUnitDepth($from);
  if (blockDepth === 0) return false;

  const blockIndex = $from.index(blockDepth - 1);
  const parent = $from.node(blockDepth - 1);

  if (direction === "up" && blockIndex === 0) return false; // Already at top
  if (direction === "down" && blockIndex >= parent.childCount - 1) return false; // Already at bottom
  // Never displace a table's header: moving up may not land above it, and the
  // header itself may not move down out of first place.
  if (isTableHeaderRow(parent, direction === "up" ? blockIndex - 1 : blockIndex)) return false;

  const currentBlock = parent.child(blockIndex);
  const otherBlock = parent.child(direction === "up" ? blockIndex - 1 : blockIndex + 1);

  // Swap the adjacent pair: delete the lower block, re-insert it above.
  const pos = $from.before(blockDepth);
  const upperStart = direction === "up" ? pos - otherBlock.nodeSize : pos;
  const upperBlock = direction === "up" ? otherBlock : currentBlock;
  const lowerBlock = direction === "up" ? currentBlock : otherBlock;
  const lowerStart = upperStart + upperBlock.nodeSize;

  const tr = state.tr;
  tr.delete(lowerStart, lowerStart + lowerBlock.nodeSize);
  tr.insert(upperStart, lowerBlock);

  // Update selection to stay with the moved block
  const newPos = direction === "up" ? upperStart + 1 : upperStart + lowerBlock.nodeSize + 1;
  tr.setSelection(Selection.near(tr.doc.resolve(newPos)));

  dispatch(tr);
  editor.commands.focus();
  return true;
}

/**
 * Move the line at the cursor up (swap with the line above it).
 */
export function handleWysiwygMoveBlockUp(context: WysiwygToolbarContext): boolean {
  return moveLineUnit(context, "up");
}

/**
 * Move the line at the cursor down (swap with the line below it).
 */
export function handleWysiwygMoveBlockDown(context: WysiwygToolbarContext): boolean {
  return moveLineUnit(context, "down");
}

/**
 * Duplicate the current top-level block immediately after itself.
 */
export function handleWysiwygDuplicateBlock(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { $from } = state.selection;
  const hardBreak = state.schema.nodes.hardBreak;

  // Inside a hard-break paragraph, duplicate only the line at the cursor —
  // the copy goes right after it, behind its own delimiter.
  const line = textblockLineAt($from);
  if (line && hardBreak) {
    const tr = state.tr;
    tr.insert(line.to, Fragment.from(hardBreak.create()).append(cutLineRange($from, line)));
    tr.setSelection(Selection.near(tr.doc.resolve($from.pos)));
    dispatch(tr);
    editor.commands.focus();
    return true;
  }

  const blockDepth = lineUnitDepth($from);
  if (blockDepth === 0) return false;

  const blockIndex = $from.index(blockDepth - 1);
  const parent = $from.node(blockDepth - 1);
  const currentBlock = parent.child(blockIndex);

  const tr = state.tr;
  const blockEnd = $from.after(blockDepth);

  // Only a PARAGRAPH takes the hard-break path. A heading cannot contain one —
  // the break collapses and the two copies run together on one line — so a
  // heading duplicates as a sibling heading, like every structural unit.
  if (currentBlock.type.name === "paragraph" && hardBreak) {
    // A paragraph duplicated as a second PARAGRAPH is not the same action:
    // "duplicate line" should leave one block with two visible lines, which in
    // markdown means a hard break. Cloning the node produced two paragraphs
    // where Source produced two lines, and the documents genuinely differed.
    const doubled = currentBlock.content
      .append(Fragment.from(hardBreak.create()))
      .append(currentBlock.content);
    tr.replaceWith($from.before(blockDepth), blockEnd, currentBlock.copy(doubled));
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min($from.pos, tr.doc.content.size))));
  } else {
    // Structural units — a table row, a list item — duplicate as siblings.
    tr.insert(blockEnd, currentBlock.copy(currentBlock.content));
    tr.setSelection(Selection.near(tr.doc.resolve(blockEnd + 1)));
  }

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

  // Inside a hard-break paragraph, delete the line at the cursor plus one
  // delimiter, so the remaining lines keep single breaks between them.
  const line = textblockLineAt($from);
  if (line) {
    const del = lineDeletionRange(line);
    const tr = state.tr;
    tr.delete(del.from, del.to);
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(del.from, tr.doc.content.size))));
    dispatch(tr);
    editor.commands.focus();
    return true;
  }

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
        // Only delete if the empty textblock is fully within the selection
        // (its collapsed ancestor husk may extend a step past it).
        const nodeEnd = pos + node.nodeSize;
        if (pos >= from && nodeEnd <= to) {
          const $pos = state.doc.resolve(pos + 1);
          // An empty paragraph in a table cell is an empty CELL, not a blank
          // markdown line — deleting it would only be re-fitted away, and
          // widening would take the cell out of its row. Leave tables alone.
          if (!withinTable($pos)) {
            // Deleting only the textblock re-grows it whenever the parent's
            // content spec demands a block (listItem is "paragraph block*"):
            // the replace-fitter re-inserts an empty paragraph and the
            // "removal" dispatches as a no-op. Widen past the ancestors the
            // deletion would leave empty, so the empty list item goes too.
            const d = collapseEmptyAncestors($pos, $pos.depth);
            nodesToDelete.push({ from: $pos.before(d), to: $pos.after(d) });
          }
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

  // Success is only success when the document actually changed — a dispatch
  // the replace-fitter fully undid must not be reported as a removal.
  /* v8 ignore next -- @preserve defensive: with ancestor widening no constructed case still no-ops */
  if (tr.doc.eq(state.doc)) return false;

  dispatch(tr);
  editor.commands.focus();
  return true;
}
