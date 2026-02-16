/**
 * Split-Block Composition Fix
 *
 * Purpose: Repairs a macOS WebKit bug where accepting an IME composition
 * with Space in a heading node causes the composed text to land in a new
 * paragraph below the heading instead of replacing the pinyin inline.
 *
 * The browser fires a non-composition transaction that splits the heading
 * into heading + paragraph, then inserts the composed text into the paragraph.
 * This function detects that split and moves the composed text back into
 * the original heading.
 *
 * @coordinates-with plugins/compositionGuard/tiptap.ts — called from scheduleImeCleanup
 * @module plugins/compositionGuard/splitBlockFix
 */

import { type EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";

/**
 * Detect and fix a split-block composition bug.
 *
 * @param state      Current editor state (after the split has happened)
 * @param startPos   Position where composition began (inside the heading)
 * @param composed   The final composed text (e.g., "我看看")
 * @param pinyin     The pinyin that was typed during composition (e.g., "wo kj kj")
 * @returns          A corrective Transaction, or null if no fix is needed
 */
export function fixCompositionSplitBlock(
  state: EditorState,
  startPos: number,
  composed: string,
  pinyin: string,
): Transaction | null {
  if (!composed || !pinyin) return null;

  let $start;
  try {
    $start = state.doc.resolve(startPos);
  } catch {
    return null;
  }

  const parentNode = $start.parent;
  const $cursor = state.doc.resolve(state.selection.from);

  // No fix needed if cursor is in the same block
  if ($cursor.parent === parentNode) return null;

  // The spurious block must be a paragraph with exactly the composed text
  if ($cursor.parent.type.name !== "paragraph") return null;
  if ($cursor.parent.textContent !== composed) return null;

  // The spurious block must come immediately after the original block
  const blockStart = $cursor.before($cursor.depth);
  const expectedSiblingStart = $start.after($start.depth);
  if (blockStart !== expectedSiblingStart) return null;

  // Verify pinyin is at the expected position in the original block
  const pinyinEnd = startPos + pinyin.length;
  if (pinyinEnd > $start.end()) return null;

  let textAtPos: string;
  try {
    textAtPos = state.doc.textBetween(startPos, pinyinEnd);
  } catch {
    return null;
  }
  if (textAtPos !== pinyin) return null;

  const tr = state.tr;

  // Delete the spurious paragraph (immediately after original block).
  // Since it's later in the doc, positions before it are unaffected.
  const blockEnd = $cursor.after($cursor.depth);
  tr.delete(blockStart, blockEnd);

  // Replace pinyin in original block with composed text.
  // After deleting the later block, heading positions are unchanged.
  tr.insertText(composed, startPos, pinyinEnd);

  // Place cursor at end of composed text
  const newCursorPos = startPos + composed.length;
  tr.setSelection(TextSelection.create(tr.doc, newCursorPos));

  tr.setMeta("uiEvent", "composition-cleanup");
  return tr;
}
