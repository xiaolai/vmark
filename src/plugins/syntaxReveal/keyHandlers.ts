/**
 * Syntax Reveal Plugin - Key Handlers
 *
 * Handles keyboard interactions with revealed syntax markers.
 * Allows users to delete format chars to remove marks/formatting.
 */

import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Node, Mark, ResolvedPos } from "@milkdown/kit/prose/model";

// Mark type to syntax mapping (for length calculation)
const MARK_SYNTAX_LENGTH: Record<string, number> = {
  strong: 2, // **
  emphasis: 1, // *
  inlineCode: 1, // `
  strikethrough: 2, // ~~
  subscript: 1, // ~
  superscript: 1, // ^
  highlight: 2, // ==
};

interface MarkRange {
  mark: Mark;
  from: number;
  to: number;
}

/**
 * Find the full range of a mark
 */
function findMarkRange(
  pos: number,
  mark: Mark,
  parentStart: number,
  parent: Node
): MarkRange | null {
  let from = -1;
  let to = -1;

  parent.forEach((child, childOffset) => {
    const childFrom = parentStart + childOffset;
    const childTo = childFrom + child.nodeSize;

    if (child.isText && mark.isInSet(child.marks)) {
      if (from === -1) {
        from = childFrom;
      }
      to = childTo;
    } else if (from !== -1 && to !== -1) {
      if (pos >= from && pos <= to) {
        return;
      }
      from = -1;
      to = -1;
    }
  });

  if (from !== -1 && to !== -1 && pos >= from && pos <= to) {
    return { mark, from, to };
  }

  return null;
}

/**
 * Find all mark ranges at cursor position
 */
function findMarksAtPosition(pos: number, $pos: ResolvedPos): MarkRange[] {
  const ranges: MarkRange[] = [];
  const parent = $pos.parent;
  const parentStart = $pos.start();

  parent.forEach((child, childOffset) => {
    const from = parentStart + childOffset;
    const to = from + child.nodeSize;

    if (pos >= from && pos <= to && child.isText) {
      child.marks.forEach((mark) => {
        const markRange = findMarkRange(pos, mark, parentStart, parent);
        if (markRange) {
          if (
            !ranges.some(
              (r) => r.from === markRange.from && r.to === markRange.to
            )
          ) {
            ranges.push(markRange);
          }
        }
      });
    }
  });

  return ranges;
}

/**
 * Handle backspace key at mark boundaries
 * Returns true if handled, false to let default behavior continue
 */
export function handleBackspace(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const { selection } = state;
  const { $from, empty } = selection;

  if (!empty) return false;

  const pos = $from.pos;
  const markRanges = findMarksAtPosition(pos, $from);

  // Check if cursor is at the start of any mark range
  for (const { mark, from, to } of markRanges) {
    const syntaxLength = MARK_SYNTAX_LENGTH[mark.type.name];
    if (!syntaxLength) continue;

    // Cursor at start of mark - remove the mark
    if (pos === from) {
      if (dispatch) {
        const tr = state.tr.removeMark(from, to, mark.type);
        dispatch(tr);
      }
      return true;
    }
  }

  // Handle link mark specially
  const linkRanges = markRanges.filter((r) => r.mark.type.name === "link");
  for (const { mark, from, to } of linkRanges) {
    if (pos === from) {
      if (dispatch) {
        const tr = state.tr.removeMark(from, to, mark.type);
        dispatch(tr);
      }
      return true;
    }
  }

  return false;
}

/**
 * Handle delete key at mark boundaries
 * Returns true if handled, false to let default behavior continue
 */
export function handleDelete(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const { selection } = state;
  const { $from, empty } = selection;

  if (!empty) return false;

  const pos = $from.pos;
  const markRanges = findMarksAtPosition(pos, $from);

  // Check if cursor is at the end of any mark range
  for (const { mark, from, to } of markRanges) {
    const syntaxLength = MARK_SYNTAX_LENGTH[mark.type.name];
    if (!syntaxLength) continue;

    // Cursor at end of mark - remove the mark
    if (pos === to) {
      if (dispatch) {
        const tr = state.tr.removeMark(from, to, mark.type);
        dispatch(tr);
      }
      return true;
    }
  }

  // Handle link mark specially
  const linkRanges = markRanges.filter((r) => r.mark.type.name === "link");
  for (const { mark, from, to } of linkRanges) {
    if (pos === to) {
      if (dispatch) {
        const tr = state.tr.removeMark(from, to, mark.type);
        dispatch(tr);
      }
      return true;
    }
  }

  return false;
}

/**
 * Create keyboard event handlers for the plugin
 */
export function createKeyHandlers() {
  return {
    handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
      // Only handle plain backspace/delete without modifiers
      if (event.ctrlKey || event.altKey || event.metaKey) {
        return false;
      }

      if (event.key === "Backspace") {
        return handleBackspace(view.state, view.dispatch);
      }

      if (event.key === "Delete") {
        return handleDelete(view.state, view.dispatch);
      }

      return false;
    },
  };
}
