/**
 * Multi-cursor decorations for ProseMirror
 *
 * Creates visual decorations for multi-cursor selections.
 * Uses a custom caret when multi-cursor is active so all cursors blink in sync.
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
 * - Primary cursor (empty range): widget decoration with caret
 * - Primary selection (non-empty range): no decoration (browser handles highlight)
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
    const isPrimary = index === primaryIndex;

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
      if (!isPrimary) {
        const selectionDeco = Decoration.inline(from, to, {
          class: SELECTION_CLASS,
        });
        decorations.push(selectionDeco);
      }
    }
  });

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Creates the DOM element for a cursor caret.
 *
 * @returns HTMLElement representing the cursor caret
 */
function createCursorElement(): HTMLElement {
  const cursor = document.createElement("span");
  cursor.className = CURSOR_CLASS;
  cursor.setAttribute("aria-hidden", "true");
  return cursor;
}
