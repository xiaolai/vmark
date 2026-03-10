/**
 * Multi-cursor input handling for ProseMirror
 *
 * Handles typing, backspace, and delete operations across multiple cursors.
 * Edits are applied in reverse document order to preserve position validity.
 */
import { Selection, SelectionRange } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { MultiSelection } from "./MultiSelection";
import { isImeKeyEvent } from "@/utils/imeGuard";
import {
  normalizeRangesWithPrimary,
  remapBackwardFlags,
  sortRangesDescending,
} from "./rangeUtils";
import {
  handleMultiCursorHorizontal,
  type HorizontalUnit,
} from "./horizontalMovement";
import { handleMultiCursorEnter } from "./enterHandling";

export { handleMultiCursorEnter };

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

  // Remap selection through the changes, merging any overlaps caused by edits
  const newRanges = selection.ranges.map((range) => {
    const newFrom = tr.mapping.map(range.$from.pos);
    const newTo = tr.mapping.map(range.$to.pos);
    const $from = tr.doc.resolve(newFrom);
    const $to = tr.doc.resolve(newTo);
    return new SelectionRange($from, $to);
  });

  const merged = normalizeRangesWithPrimary(newRanges, tr.doc, selection.primaryIndex, true);
  const newSel = new MultiSelection(merged.ranges, merged.primaryIndex);
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
    } else {
      const $pos = state.doc.resolve(from);
      if ($pos.parentOffset > 0) {
        // Use Unicode-aware iteration to find the proper character boundary,
        // so surrogate pairs (emoji) are deleted as a whole unit.
        const textBefore = $pos.parent.textBetween(0, $pos.parentOffset);
        const lastChar = [...textBefore].at(-1);
        const charLen = lastChar ? lastChar.length : 1;
        tr = tr.delete(from - charLen, from);
      }
    }
  }

  // Remap selection through the changes, merging any overlaps caused by edits
  const newRanges: SelectionRange[] = [];
  for (const range of selection.ranges) {
    const newPos = tr.mapping.map(range.$from.pos);
    const $pos = tr.doc.resolve(newPos);
    newRanges.push(new SelectionRange($pos, $pos));
  }

  const merged = normalizeRangesWithPrimary(newRanges, tr.doc, selection.primaryIndex, true);
  const newSel = new MultiSelection(merged.ranges, merged.primaryIndex);
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

  // Apply deletions from end to start
  for (const range of sortedRanges) {
    const from = range.$from.pos;
    const to = range.$to.pos;

    if (from !== to) {
      // Selection - delete selected text
      tr = tr.delete(from, to);
    } else {
      const $pos = state.doc.resolve(from);
      if ($pos.parentOffset < $pos.parent.content.size) {
        // Use Unicode-aware iteration to find the proper character boundary,
        // so surrogate pairs (emoji) are deleted as a whole unit.
        const textAfter = $pos.parent.textBetween($pos.parentOffset, $pos.parent.content.size);
        const firstChar = [...textAfter].at(0);
        const charLen = firstChar ? firstChar.length : 1;
        tr = tr.delete(from, from + charLen);
      }
    }
  }

  // Remap selection through the changes, merging any overlaps caused by edits
  const newRanges: SelectionRange[] = [];
  for (const range of selection.ranges) {
    const newPos = tr.mapping.map(range.$from.pos);
    const $pos = tr.doc.resolve(newPos);
    newRanges.push(new SelectionRange($pos, $pos));
  }

  const merged = normalizeRangesWithPrimary(newRanges, tr.doc, selection.primaryIndex, true);
  const newSel = new MultiSelection(merged.ranges, merged.primaryIndex);
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
/** Fallback line height (px) when coordsAtPos returns zero-height rect */
const DEFAULT_LINE_HEIGHT_PX = 20;

export function handleMultiCursorArrow(
  state: EditorState,
  direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
  extend: boolean,
  view?: EditorView
): Transaction | null {
  const { selection, doc } = state;

  if (!(selection instanceof MultiSelection)) {
    return null;
  }

  const dir = direction === "ArrowLeft" || direction === "ArrowUp" ? -1 : 1;
  const isVertical = direction === "ArrowUp" || direction === "ArrowDown";

  const backwardFlags = selection.backward;
  const nextRanges = selection.ranges.map((range, i) => {
    // Non-empty selection without extend: collapse to start or end
    if (!extend && range.$from.pos !== range.$to.pos) {
      const collapsePos = dir < 0 ? range.$from.pos : range.$to.pos;
      const $pos = doc.resolve(collapsePos);
      return new SelectionRange($pos, $pos);
    }

    const isBackward = backwardFlags?.[i];
    const headPos = isBackward ? range.$from.pos : range.$to.pos;

    // Vertical movement: use coordinate-based placement when view is available
    if (isVertical && view) {
      const coords = view.coordsAtPos(headPos);
      const lineHeight = coords.bottom - coords.top || DEFAULT_LINE_HEIGHT_PX;
      const targetY = dir < 0
        ? coords.top - lineHeight / 2
        : coords.bottom + lineHeight / 2;
      const result = view.posAtCoords({ left: coords.left, top: targetY });
      if (!result) return range;
      const targetPos = result.pos;
      if (extend) {
        const anchorPos = isBackward ? range.$to.pos : range.$from.pos;
        const from = Math.min(anchorPos, targetPos);
        const to = Math.max(anchorPos, targetPos);
        return new SelectionRange(doc.resolve(from), doc.resolve(to));
      }
      const $pos = doc.resolve(targetPos);
      return new SelectionRange($pos, $pos);
    }

    // Horizontal movement or vertical fallback (no view)
    const startPos = isVertical ? headPos : Math.max(0, Math.min(doc.content.size, headPos + dir));
    const $head = doc.resolve(startPos);
    const found = Selection.findFrom($head, dir, true);

    if (!found) {
      return range;
    }

    const targetPos = dir < 0 ? found.from : found.to;
    if (extend) {
      const anchorPos = isBackward ? range.$to.pos : range.$from.pos;
      const from = Math.min(anchorPos, targetPos);
      const to = Math.max(anchorPos, targetPos);
      return new SelectionRange(doc.resolve(from), doc.resolve(to));
    }

    const $pos = doc.resolve(targetPos);
    return new SelectionRange($pos, $pos);
  });

  // Derive updated backward flags: compare original anchor to new head
  const newBackward = nextRanges.map((range, i) => {
    if (range.$from.pos === range.$to.pos) return false;
    /* v8 ignore next -- @preserve non-extend (collapsed) move always returns false; range equality checked above */
    if (!extend) return false;
    const origRange = selection.ranges[i];
    const anchorPos = backwardFlags?.[i] ? origRange.$to.pos : origRange.$from.pos;
    const headPos = range.$from.pos === anchorPos ? range.$to.pos
      : range.$to.pos === anchorPos ? range.$from.pos
      : /* v8 ignore next -- @preserve defensive fallback: SelectionRange always has anchor at from or to */ (dir < 0 ? range.$from.pos : range.$to.pos);
    return anchorPos > headPos;
  });

  const normalized = normalizeRangesWithPrimary(
    nextRanges,
    doc,
    selection.primaryIndex
  );
  const remappedBackward = remapBackwardFlags(nextRanges, newBackward, normalized.ranges);
  const newSel = new MultiSelection(normalized.ranges, normalized.primaryIndex, remappedBackward);
  return state.tr.setSelection(newSel);
}

export type MultiCursorKeyEvent = Pick<
  KeyboardEvent,
  "key" | "shiftKey" | "isComposing" | "keyCode" | "altKey" | "ctrlKey" | "metaKey"
>;

/**
 * Handle keydown events for multi-cursor selection.
 */
export function handleMultiCursorKeyDown(
  state: EditorState,
  event: MultiCursorKeyEvent,
  view?: EditorView
): Transaction | null {
  if (!(state.selection instanceof MultiSelection)) {
    return null;
  }

  if (isImeKeyEvent(event as KeyboardEvent)) {
    return null;
  }

  switch (event.key) {
    case "Enter":
      // Only handle bare Enter; let Shift+Enter (hard break) etc. fall through
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return null;
      }
      return handleMultiCursorEnter(state);
    case "Backspace":
      return handleMultiCursorBackspace(state);
    case "Delete":
      return handleMultiCursorDelete(state);
    case "ArrowLeft":
    case "ArrowRight": {
      const unit: HorizontalUnit = event.metaKey
        ? "line"
        : event.altKey || event.ctrlKey
          ? "word"
          : "char";
      return handleMultiCursorHorizontal(state, event.key, event.shiftKey, unit);
    }
    case "ArrowUp":
    case "ArrowDown":
      if (event.metaKey || event.altKey || event.ctrlKey) {
        return null;
      }
      return handleMultiCursorArrow(state, event.key, event.shiftKey, view);
    default:
      return null;
  }
}
