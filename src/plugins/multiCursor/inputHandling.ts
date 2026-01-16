/**
 * Multi-cursor input handling for ProseMirror
 *
 * Handles typing, backspace, and delete operations across multiple cursors.
 * Edits are applied in reverse document order to preserve position validity.
 */
import { Selection, SelectionRange } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { MultiSelection } from "./MultiSelection";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { normalizeRangesWithPrimary } from "./rangeUtils";

/**
 * Sort ranges by position (descending) for safe editing.
 * Editing from end to start preserves earlier positions.
 */
function sortRangesDescending(
  ranges: readonly SelectionRange[]
): SelectionRange[] {
  return [...ranges].sort((a, b) => b.$from.pos - a.$from.pos);
}

/**
 * Handle text input at all cursor positions.
 * Inserts text at cursors, replaces text in selections.
 *
 * @param state - Current editor state
 * @param text - Text to insert
 * @returns Transaction or null if not a MultiSelection
 */
export function handleMultiCursorInput(
  state: EditorState,
  text: string,
  options?: { isComposing?: boolean }
): Transaction | null {
  const { selection } = state;

  if (!(selection instanceof MultiSelection)) {
    return null;
  }
  if (options?.isComposing) {
    return null;
  }

  const sortedRanges = sortRangesDescending(selection.ranges);
  let tr = state.tr;

  // Apply insertions from end to start
  for (const range of sortedRanges) {
    const from = range.$from.pos;
    const to = range.$to.pos;
    tr = tr.insertText(text, from, to);
  }

  // Remap selection through the changes
  const newRanges = selection.ranges.map((range) => {
    const newFrom = tr.mapping.map(range.$from.pos);
    const newTo = tr.mapping.map(range.$to.pos);
    // After insertion, cursor should be after the inserted text
    const $from = tr.doc.resolve(newFrom);
    const $to = tr.doc.resolve(newTo);
    return new SelectionRange($from, $to);
  });

  const newSel = new MultiSelection(newRanges, selection.primaryIndex);
  tr = tr.setSelection(newSel);
  tr = tr.setMeta("addToHistory", true);

  return tr;
}

/**
 * Handle backspace at all cursor positions.
 * Deletes selection or character before cursor.
 *
 * @param state - Current editor state
 * @returns Transaction or null if not a MultiSelection
 */
export function handleMultiCursorBackspace(
  state: EditorState
): Transaction | null {
  const { selection } = state;

  if (!(selection instanceof MultiSelection)) {
    return null;
  }

  const sortedRanges = sortRangesDescending(selection.ranges);
  let tr = state.tr;

  // Apply deletions from end to start
  for (const range of sortedRanges) {
    const from = range.$from.pos;
    const to = range.$to.pos;

    if (from !== to) {
      // Selection - delete selected text
      tr = tr.delete(from, to);
    } else if (from > 1) {
      // Cursor - delete character before (pos > 1 to stay in document)
      tr = tr.delete(from - 1, from);
    }
    // If at start, do nothing for this cursor
  }

  // Remap selection through the changes
  const newRanges: SelectionRange[] = [];
  for (const range of selection.ranges) {
    const newPos = tr.mapping.map(range.$from.pos);
    const $pos = tr.doc.resolve(newPos);
    newRanges.push(new SelectionRange($pos, $pos));
  }

  const newSel = new MultiSelection(newRanges, selection.primaryIndex);
  tr = tr.setSelection(newSel);
  tr = tr.setMeta("addToHistory", true);

  return tr;
}

/**
 * Handle delete at all cursor positions.
 * Deletes selection or character after cursor.
 *
 * @param state - Current editor state
 * @returns Transaction or null if not a MultiSelection
 */
export function handleMultiCursorDelete(
  state: EditorState
): Transaction | null {
  const { selection } = state;

  if (!(selection instanceof MultiSelection)) {
    return null;
  }

  const sortedRanges = sortRangesDescending(selection.ranges);
  let tr = state.tr;
  const docSize = state.doc.content.size;

  // Apply deletions from end to start
  for (const range of sortedRanges) {
    const from = range.$from.pos;
    const to = range.$to.pos;

    if (from !== to) {
      // Selection - delete selected text
      tr = tr.delete(from, to);
    } else if (to < docSize - 1) {
      // Cursor - delete character after (if not at end)
      tr = tr.delete(from, from + 1);
    }
    // If at end, do nothing for this cursor
  }

  // Remap selection through the changes
  const newRanges: SelectionRange[] = [];
  for (const range of selection.ranges) {
    const newPos = tr.mapping.map(range.$from.pos);
    const $pos = tr.doc.resolve(newPos);
    newRanges.push(new SelectionRange($pos, $pos));
  }

  const newSel = new MultiSelection(newRanges, selection.primaryIndex);
  tr = tr.setSelection(newSel);
  tr = tr.setMeta("addToHistory", true);

  return tr;
}

/**
 * Handle arrow key movement for multi-cursor.
 * Moves or extends all cursors in the same direction.
 *
 * @param state - Current editor state
 * @param direction - Arrow key direction
 * @param extend - Whether to extend selection (Shift+Arrow)
 * @returns Transaction or null if not a MultiSelection
 */
export function handleMultiCursorArrow(
  state: EditorState,
  direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
  extend: boolean
): Transaction | null {
  const { selection, doc } = state;

  if (!(selection instanceof MultiSelection)) {
    return null;
  }

  const dir = direction === "ArrowLeft" || direction === "ArrowUp" ? -1 : 1;
  const isVertical = direction === "ArrowUp" || direction === "ArrowDown";

  const nextRanges = selection.ranges.map((range) => {
    const headPos = range.$to.pos;
    const startPos = isVertical ? headPos : Math.max(0, Math.min(doc.content.size, headPos + dir));
    const $head = doc.resolve(startPos);
    const found = Selection.findFrom($head, dir, true);

    if (!found) {
      return range;
    }

    const targetPos = dir < 0 ? found.from : found.to;
    if (extend) {
      const anchorPos = range.$from.pos;
      const from = Math.min(anchorPos, targetPos);
      const to = Math.max(anchorPos, targetPos);
      return new SelectionRange(doc.resolve(from), doc.resolve(to));
    }

    const $pos = doc.resolve(targetPos);
    return new SelectionRange($pos, $pos);
  });

  const normalized = normalizeRangesWithPrimary(
    nextRanges,
    doc,
    selection.primaryIndex
  );
  const newSel = new MultiSelection(normalized.ranges, normalized.primaryIndex);
  return state.tr.setSelection(newSel);
}

export type MultiCursorKeyEvent = Pick<
  KeyboardEvent,
  "key" | "shiftKey" | "isComposing" | "keyCode"
>;

/**
 * Handle keydown events for multi-cursor selection.
 */
export function handleMultiCursorKeyDown(
  state: EditorState,
  event: MultiCursorKeyEvent
): Transaction | null {
  if (!(state.selection instanceof MultiSelection)) {
    return null;
  }

  if (isImeKeyEvent(event as KeyboardEvent)) {
    return null;
  }

  switch (event.key) {
    case "Backspace":
      return handleMultiCursorBackspace(state);
    case "Delete":
      return handleMultiCursorDelete(state);
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown":
      return handleMultiCursorArrow(state, event.key, event.shiftKey);
    default:
      return null;
  }
}
