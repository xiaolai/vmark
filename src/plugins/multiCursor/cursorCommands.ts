/**
 * Cursor-management multi-cursor commands for ProseMirror.
 *
 * Commands that manipulate the cursor set itself (not text matches):
 * - collapseMultiSelection: Collapse to single cursor (Escape)
 * - softUndoCursor: Revert last cursor addition (Cmd+Alt+Z)
 * - addCursorAbove / addCursorBelow: Add a cursor vertically (Cmd+Alt+Arrow)
 *
 * Extracted from commands.ts, which remains the stable entry point.
 */
import { TextSelection, SelectionRange } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { MultiSelection } from "./MultiSelection";
import { multiCursorPluginKey } from "./multiCursorPlugin";
import {
  positionWithinRanges,
  selectionWithAddedPrimaryRange,
} from "./commandHelpers";

/** Fallback line height (px) when coordsAtPos returns zero-height rect */
const DEFAULT_LINE_HEIGHT_PX = 20;

/**
 * Collapse multi-selection to single cursor at primary position.
 *
 * @param state - Current editor state
 * @returns Transaction or null if not a MultiSelection
 */
export function collapseMultiSelection(state: EditorState): Transaction | null {
  const { selection } = state;

  if (!(selection instanceof MultiSelection)) {
    return null;
  }

  const primary = selection.ranges[selection.primaryIndex];
  const newSel = TextSelection.create(
    state.doc,
    primary.$from.pos,
    primary.$to.pos
  );

  return state.tr.setSelection(newSel);
}

/**
 * Soft undo: revert to the previous selection state before the last Cmd+D.
 * Pops the most recent entry from the selection history stack.
 *
 * @param state - Current editor state
 * @returns Transaction or null if no history
 */
export function softUndoCursor(state: EditorState): Transaction | null {
  if (!(state.selection instanceof MultiSelection)) return null;

  const pluginState = multiCursorPluginKey.getState(state);
  if (!pluginState || pluginState.selectionHistory.length === 0) return null;

  const newHistory = pluginState.selectionHistory.slice(0, -1);
  const snapshot = pluginState.selectionHistory[pluginState.selectionHistory.length - 1];

  // Restore the snapshot selection
  const ranges = snapshot.ranges.map((r) => {
    const $from = state.doc.resolve(r.from);
    const $to = state.doc.resolve(r.to);
    return new SelectionRange($from, $to);
  });

  let sel;
  if (ranges.length === 1) {
    sel = TextSelection.create(
      state.doc,
      ranges[0].$from.pos,
      ranges[0].$to.pos
    );
  } else {
    sel = new MultiSelection(ranges, snapshot.primaryIndex);
  }

  return state.tr
    .setSelection(sel)
    .setMeta(multiCursorPluginKey, { popHistory: newHistory });
}

/**
 * Add a cursor one line above the topmost cursor position.
 * Uses view.coordsAtPos/posAtCoords for accurate vertical placement.
 *
 * @param state - Current editor state
 * @param view - Editor view (needed for coordinate mapping)
 * @returns Transaction or null if no position above
 */
export function addCursorAbove(
  state: EditorState,
  view: EditorView
): Transaction | null {
  return addCursorVertical(state, view, -1);
}

/**
 * Add a cursor one line below the bottommost cursor position.
 * Uses view.coordsAtPos/posAtCoords for accurate vertical placement.
 *
 * @param state - Current editor state
 * @param view - Editor view (needed for coordinate mapping)
 * @returns Transaction or null if no position below
 */
export function addCursorBelow(
  state: EditorState,
  view: EditorView
): Transaction | null {
  return addCursorVertical(state, view, 1);
}

/**
 * Internal: add a cursor vertically (above or below) the extreme cursor.
 */
function addCursorVertical(
  state: EditorState,
  view: EditorView,
  direction: -1 | 1
): Transaction | null {
  const { selection } = state;

  // Collect existing cursor positions
  let existingRanges: SelectionRange[];

  if (selection instanceof MultiSelection) {
    existingRanges = [...selection.ranges];
  } else {
    const $from = state.doc.resolve(selection.from);
    const $to = state.doc.resolve(selection.to);
    existingRanges = [new SelectionRange($from, $to)];
  }

  // Find the extreme range (topmost for above, bottommost for below)
  const extremeRange =
    direction === -1
      ? existingRanges.reduce((min, r) =>
          /* v8 ignore next -- @preserve ranges sorted ascending; r < min is structurally unreachable */
          r.$from.pos < min.$from.pos ? r : min
        )
      : existingRanges.reduce((max, r) =>
          /* v8 ignore next -- @preserve ranges sorted ascending; r <= max fallback is structurally unreachable */
          r.$from.pos > max.$from.pos ? r : max
        );

  const pos = extremeRange.$from.pos;
  const coords = view.coordsAtPos(pos);

  // Offset by one line in the desired direction
  const lineHeight = coords.bottom - coords.top || DEFAULT_LINE_HEIGHT_PX;
  const targetY =
    direction === -1
      ? coords.top - lineHeight / 2
      : coords.bottom + lineHeight / 2;

  const result = view.posAtCoords({ left: coords.left, top: targetY });
  if (!result) return null;

  const newPos = result.pos;

  // Check if we actually moved to a different position
  if (newPos === pos) return null;

  // Reject positions already covered by an existing cursor or selection —
  // a collapsed cursor inside a non-empty range would create an overlap.
  if (positionWithinRanges(existingRanges, newPos)) return null;

  return state.tr.setSelection(
    selectionWithAddedPrimaryRange(state.doc, existingRanges, {
      from: newPos,
      to: newPos,
    })
  );
}
