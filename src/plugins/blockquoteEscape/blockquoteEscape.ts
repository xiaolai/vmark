/**
 * Blockquote Escape Handlers
 *
 * Purpose: Prevents cursor trapping when a blockquote is the first or last block
 * in the document — inserts an escape paragraph on ArrowUp/ArrowDown at boundaries.
 *
 * Key decisions:
 *   - Only fires when the blockquote is at the document edge AND cursor is at the
 *     boundary position — avoids interfering with normal blockquote navigation
 *   - Uses direct ProseMirror transactions (not Tiptap commands) for minimal overhead
 *
 * @coordinates-with blockEscape/tiptap.ts — wires these handlers into the keymap
 * @module plugins/blockquoteEscape/blockquoteEscape
 */

import type { EditorView } from "@tiptap/pm/view";
import { Selection } from "@tiptap/pm/state";

interface BlockquoteInfo {
  blockquotePos: number;
  blockquoteNode: ReturnType<typeof import("@tiptap/pm/state").EditorState.prototype.doc.nodeAt>;
}

/**
 * Get information about the blockquote containing the cursor.
 */
function getBlockquoteInfo(view: EditorView): BlockquoteInfo | null {
  const { state } = view;
  const { $from } = state.selection;

  // Find the blockquote node
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "blockquote") {
      return {
        blockquotePos: $from.before(depth),
        blockquoteNode: node,
      };
    }
  }

  return null;
}

/**
 * Check if cursor is at the start of the blockquote content.
 */
function isAtStartOfBlockquote(view: EditorView, info: BlockquoteInfo): boolean {
  const { state } = view;
  const { $from } = state.selection;

  // First content position: blockquote(1) > first child paragraph(1)
  const firstContentPos = info.blockquotePos + 2;

  return $from.pos <= firstContentPos;
}

/**
 * Check if cursor is at the end of the blockquote content.
 */
function isAtEndOfBlockquote(view: EditorView, info: BlockquoteInfo): boolean {
  const { state } = view;
  const { $from } = state.selection;

  if (!info.blockquoteNode) return false;
  const blockquoteEnd = info.blockquotePos + info.blockquoteNode.nodeSize - 1;

  return $from.pos >= blockquoteEnd - 1;
}

/**
 * Check if blockquote is the first block in the document.
 */
function isBlockquoteFirstBlock(blockquotePos: number): boolean {
  return blockquotePos === 0;
}

/**
 * Check if blockquote is the last block in the document.
 */
function isBlockquoteLastBlock(blockquotePos: number, blockquoteNodeSize: number, docSize: number): boolean {
  return blockquotePos + blockquoteNodeSize === docSize;
}

/**
 * Handle ArrowUp when cursor is at the start of a blockquote.
 * If blockquote is the first block, insert a paragraph before it.
 * @returns true if handled, false to let default behavior proceed
 */
export function escapeBlockquoteUp(view: EditorView): boolean {
  const info = getBlockquoteInfo(view);
  if (!info) return false;

  // Only handle when at start of blockquote
  if (!isAtStartOfBlockquote(view, info)) return false;

  // Only handle when blockquote is first block
  if (!isBlockquoteFirstBlock(info.blockquotePos)) return false;

  // Insert paragraph before blockquote
  const { state, dispatch } = view;
  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType) return false;

  const tr = state.tr.insert(0, paragraphType.create());
  // Move cursor to the new paragraph (position 1, inside the paragraph)
  tr.setSelection(Selection.near(tr.doc.resolve(1)));
  dispatch(tr);
  view.focus();
  return true;
}

/**
 * Handle ArrowDown when cursor is at the end of a blockquote.
 * If blockquote is the last block, insert a paragraph after it.
 * @returns true if handled, false to let default behavior proceed
 */
export function escapeBlockquoteDown(view: EditorView): boolean {
  const info = getBlockquoteInfo(view);
  if (!info) return false;

  // Only handle when at end of blockquote
  if (!isAtEndOfBlockquote(view, info)) return false;

  // Only handle when blockquote is last block
  const docSize = view.state.doc.content.size;
  if (!info.blockquoteNode) return false;
  if (!isBlockquoteLastBlock(info.blockquotePos, info.blockquoteNode.nodeSize, docSize)) return false;

  // Insert paragraph after blockquote
  const { state, dispatch } = view;
  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType) return false;

  const insertPos = info.blockquotePos + info.blockquoteNode.nodeSize;
  const tr = state.tr.insert(insertPos, paragraphType.create());
  // Move cursor to the new paragraph
  tr.setSelection(Selection.near(tr.doc.resolve(insertPos + 1)));
  dispatch(tr);
  view.focus();
  return true;
}
