/**
 * Multi-cursor decorations for ProseMirror
 *
 * Creates visual decorations for secondary cursors and selections.
 * The primary cursor uses the native browser caret.
 */
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import { MultiSelection } from "./MultiSelection";

/** CSS class for cursor widget */
const CURSOR_CLASS = "multi-cursor-caret";

/** CSS class for selection highlight */
const SELECTION_CLASS = "multi-cursor-selection";

/**
 * Creates decorations for multi-cursor display.
 *
 * Rules:
 * - Primary cursor/selection: no decoration (browser handles it)
 * - Secondary cursors (empty ranges): widget decoration with caret
 * - Secondary selections (non-empty ranges): inline decoration with highlight
 *
 * @param state - Current editor state
 * @returns DecorationSet with cursor and selection decorations
 */
export function createMultiCursorDecorations(state: EditorState): DecorationSet {
  const { selection } = state;

  if (!(selection instanceof MultiSelection)) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];
  const primaryIndex = selection.primaryIndex;

  selection.ranges.forEach((range, index) => {
    // Skip primary range - browser handles it
    if (index === primaryIndex) {
      return;
    }

    const from = range.$from.pos;
    const to = range.$to.pos;

    if (from === to) {
      // Cursor (empty range) - create widget decoration
      const cursorWidget = Decoration.widget(from, createCursorElement, {
        class: CURSOR_CLASS,
        side: 0, // Before content at this position
      });
      decorations.push(cursorWidget);
    } else {
      // Selection (non-empty range) - create inline decoration
      const selectionDeco = Decoration.inline(from, to, {
        class: SELECTION_CLASS,
      });
      decorations.push(selectionDeco);
    }
  });

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Creates the DOM element for a secondary cursor.
 *
 * @returns HTMLElement representing the cursor caret
 */
function createCursorElement(): HTMLElement {
  const cursor = document.createElement("span");
  cursor.className = CURSOR_CLASS;
  cursor.setAttribute("aria-hidden", "true");
  return cursor;
}

/**
 * Maps existing decorations through document changes.
 *
 * @param decorations - Previous decoration set
 * @param tr - Transaction with document changes
 * @param newState - New editor state
 * @returns Updated decoration set
 */
export function mapDecorations(
  _decorations: DecorationSet,
  _tr: { mapping: { map: (pos: number) => number } },
  newState: EditorState
): DecorationSet {
  // If selection changed, recreate decorations from scratch
  // This ensures decorations always match the current selection
  if (newState.selection instanceof MultiSelection) {
    return createMultiCursorDecorations(newState);
  }

  return DecorationSet.empty;
}
