/**
 * Wrap the top-level blocks a selection spans in a new block node.
 *
 * Purpose: the ProseMirror half of `blockSpan`'s rule — a block-level wrapper
 * (alert, details) takes the WHOLE top-level blocks the selection touches. Both
 * insert commands used to ignore the selection entirely and drop an empty block
 * after it, so selecting a paragraph and pressing "Insert Note" left the
 * paragraph where it was and added a blank note underneath, while Source mode
 * folded the text in. Neither surface was reading a rule; there was none.
 *
 * Key decisions:
 *   - Depth 1 is the unit. A list is one block, items included: wrapping a
 *     single item would shatter the list into three structures.
 *   - An EMPTY selection wraps nothing and returns null, so the caller keeps its
 *     existing "insert an empty block here" path.
 *   - The wrapper is built by the caller, because only it knows the node type
 *     and attributes; this module owns the range, not the content.
 *
 * @coordinates-with blockSpan.ts — the same rule for the line-oriented surface
 * @coordinates-with alertBlock/tiptap.ts — insertAlertBlock
 * @coordinates-with detailsBlock/tiptap.ts — insertDetailsBlock
 * @module plugins/shared/wrapBlocks
 */
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import type { Fragment, Node as PMNode } from "@tiptap/pm/model";

/**
 * Outer bounds of the depth-1 blocks the selection spans, or null when the
 * selection is empty or sits at depth 0 (an AllSelection or a top-level node).
 */
export function spannedBlockRange(state: EditorState): { from: number; to: number } | null {
  const { $from, $to, empty } = state.selection;
  if (empty) return null;
  if ($from.depth === 0 || $to.depth === 0) return null;
  return { from: $from.before(1), to: $to.after(1) };
}

/**
 * Replace the spanned blocks with `build(theirContent)`.
 *
 * Returns null when there is nothing to wrap, leaving the caller's empty-insert
 * path in charge.
 */
export function wrapSpannedBlocks(
  state: EditorState,
  build: (content: Fragment) => PMNode | null,
  /**
   * Offset from the wrapper's start to where the caret belongs. Defaults to 2 —
   * inside the first child — which is right only when that child is the body.
   * A details wrapper prepends its summary, so it must pass its own offset or
   * the caret lands in the summary and typing renames the disclosure.
   */
  caretOffset?: (wrapper: PMNode) => number,
): Transaction | null {
  const range = spannedBlockRange(state);
  if (!range) return null;

  const content = state.doc.slice(range.from, range.to).content;
  /* v8 ignore next -- @preserve defensive: the range always spans a whole depth-1 block, so the slice is never empty */
  if (content.size === 0) return null;

  const wrapper = build(content);
  if (!wrapper) return null;

  const tr = state.tr.replaceWith(range.from, range.to, wrapper);
  const offset = caretOffset ? caretOffset(wrapper) : 2;
  const target = Math.min(range.from + offset, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(target)));
  return tr.scrollIntoView();
}
