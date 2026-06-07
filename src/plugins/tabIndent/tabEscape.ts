/**
 * Tab Escape for WYSIWYG Mode
 *
 * Detects when cursor is at the end of an inline mark (bold, italic, code, strike)
 * or inside a link, and provides target position for Tab to jump out.
 */

import type { EditorState } from "@tiptap/pm/state";
import { SelectionRange } from "@tiptap/pm/state";
import { MultiSelection } from "@/plugins/multiCursor/MultiSelection";

/** Mark types that Tab can escape from */
const ESCAPABLE_MARKS = new Set(["bold", "italic", "code", "strike"]);

export interface TabEscapeResult {
  type: "mark" | "link";
  targetPos: number;
}

/**
 * Check if cursor is inside a link.
 */
export function isInLink(state: EditorState): boolean {
  const { selection } = state;
  const { from, to, $from } = selection;

  // Only handle cursor, not selection
  if (from !== to) return false;

  // Check if link mark is active at cursor
  const linkMark = $from.marks().find((m) => m.type.name === "link");
  return linkMark !== undefined;
}

/**
 * Get the position after the current inline mark ends.
 * Returns null if not in an escapable mark or if there's a selection.
 */
export function getMarkEndPos(state: EditorState): number | null {
  const { selection } = state;
  const { from, to, $from } = selection;

  // Only handle cursor, not selection
  if (from !== to) return null;

  // Get escapable marks at cursor
  const marks = $from.marks().filter((m) => ESCAPABLE_MARKS.has(m.type.name));
  if (marks.length === 0) return null;

  const markType = marks[0].type;
  const parent = $from.parent;
  const parentStart = $from.start();

  // Find the text node we're currently in
  let offset = 0;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childStart = parentStart + offset;
    const childEnd = childStart + child.nodeSize;

    // Check if cursor is in this child node (inclusive of end boundary)
    if (from >= childStart && from <= childEnd) {
      // Check if this node has our mark
      /* v8 ignore next 3 -- @preserve false branch unreachable: getMarkEndPos only runs when $from.marks() includes the mark, so the child containing the cursor always has the mark */
      if (child.marks.some((m) => m.type === markType)) {
        // Return position right after this text node
        return childEnd;
      }
    }

    offset += child.nodeSize;
  }

  return null;
}

/**
 * Get the position after the current link ends.
 * Returns null if not in a link or if there's a selection.
 */
export function getLinkEndPos(state: EditorState): number | null {
  const { selection } = state;
  const { from, to, $from } = selection;

  // Only handle cursor, not selection
  if (from !== to) return null;

  // Check if in a link
  const linkMark = $from.marks().find((m) => m.type.name === "link");
  if (!linkMark) return null;

  const parent = $from.parent;
  const parentStart = $from.start();

  // Find the text node we're currently in
  let offset = 0;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childStart = parentStart + offset;
    const childEnd = childStart + child.nodeSize;

    // Check if cursor is in this child node
    if (from >= childStart && from < childEnd) {
      // Check if this node has the link mark
      /* v8 ignore next 3 -- @preserve false branch unreachable: getLinkEndPos only runs when $from.marks() includes link, so the child containing the cursor always has the link mark */
      if (child.marks.some((m) => m.type.name === "link")) {
        // Return position right after this text node
        return childEnd;
      }
    }

    offset += child.nodeSize;
  }

  return null;
}

/**
 * Check if cursor is inside an escapable mark (bold, italic, code, strike).
 */
function isInEscapableMark(state: EditorState): boolean {
  const { selection } = state;
  const { from, to, $from } = selection;

  /* v8 ignore next -- @preserve defensive guard: canTabEscape only calls isInEscapableMark after confirming from === to */
  if (from !== to) return false;

  const marks = $from.marks();
  return marks.some((m) => ESCAPABLE_MARKS.has(m.type.name));
}

/**
 * Calculate escape position for a single cursor position.
 * Returns the target position or null if cursor cannot escape.
 */
function calculateEscapeForPosition(
  state: EditorState,
  pos: number
): number | null {
  const $pos = state.doc.resolve(pos);

  // Check for link first (higher priority)
  const linkMark = $pos.marks().find((m) => m.type.name === "link");
  if (linkMark) {
    const parent = $pos.parent;
    const parentStart = $pos.start();

    // Find the text node we're currently in
    let offset = 0;
    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i);
      const childStart = parentStart + offset;
      const childEnd = childStart + child.nodeSize;

      // Check if cursor is in this child node
      if (pos >= childStart && pos < childEnd) {
        // Check if this node has the link mark
        /* v8 ignore next 4 -- @preserve false branch unreachable: calculateEscapeForPosition only enters the link section when $pos.marks() includes link, so the child at cursor position always has the link mark; null arm unreachable: pos < childEnd enforced by outer if */
        if (child.marks.some((m) => m.type.name === "link")) {
          // Return position right after this text node if it's different
          return childEnd > pos ? childEnd : null;
        }
      }

      offset += child.nodeSize;
    }

    // Cursor is at the end of a link (pos === childEnd of last link node).
    // Return current position so the Tab handler clears stored marks.
    return pos;
  }

  // Check for escapable mark
  const escapableMark = $pos.marks().find((m) => ESCAPABLE_MARKS.has(m.type.name));
  if (escapableMark) {
    const markType = escapableMark.type;
    const parent = $pos.parent;
    const parentStart = $pos.start();

    // Find the text node we're currently in (inclusive of end boundary)
    let offset = 0;
    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i);
      const childStart = parentStart + offset;
      const childEnd = childStart + child.nodeSize;

      // Check if cursor is in this child node (inclusive of end boundary)
      if (pos >= childStart && pos <= childEnd) {
        // Check if this node has our mark
        /* v8 ignore next 4 -- @preserve false branch unreachable: when pos is in range, the child at that position always has the escapable mark; null arm unreachable: pos <= childEnd enforced by outer if */
        if (child.marks.some((m) => m.type === markType)) {
          // Return position right after this text node if it's different
          // When pos === childEnd, return childEnd to clear storedMarks
          return childEnd >= pos ? childEnd : null;
        }
      }

      offset += child.nodeSize;
    }
  }

  return null;
}

/**
 * Handle multi-cursor tab escape.
 * Processes each cursor independently and returns updated MultiSelection.
 */
function canTabEscapeMulti(state: EditorState): MultiSelection | null {
  const { selection } = state;

  /* v8 ignore next 3 -- @preserve defensive guard: canTabEscapeMulti is only called from canTabEscape after confirming instanceof MultiSelection */
  if (!(selection instanceof MultiSelection)) {
    return null;
  }

  const newRanges: SelectionRange[] = [];
  let hasAnyEscape = false;

  for (const range of selection.ranges) {
    const { $from, $to } = range;

    // Only process cursors, not selections
    if ($from.pos !== $to.pos) {
      newRanges.push(range);
      continue;
    }

    // Calculate escape position for this cursor
    const escapePos = calculateEscapeForPosition(state, $from.pos);

    if (escapePos !== null) {
      // Can escape - move cursor to escape position
      const $newPos = state.doc.resolve(escapePos);
      newRanges.push(new SelectionRange($newPos, $newPos));
      hasAnyEscape = true;
    } else {
      // Cannot escape - keep cursor in place
      newRanges.push(range);
    }
  }

  // Only return new selection if at least one cursor escaped
  if (!hasAnyEscape) {
    return null;
  }

  return new MultiSelection(newRanges, selection.primaryIndex);
}

/**
 * Determine if Tab can escape from current position and return target.
 *
 * For single cursor:
 * 1. If in a link, escape the link
 * 2. If in an escapable mark (bold/italic/code/strike), escape the mark
 *
 * For multi-cursor:
 * - Each cursor is processed independently
 * - Cursors that can escape move to end of their mark/link
 * - Cursors that cannot escape stay in place
 *
 * @returns TabEscapeResult with target position, MultiSelection for multi-cursor, or null if Tab shouldn't escape
 */
export function canTabEscape(state: EditorState): TabEscapeResult | MultiSelection | null {
  const { selection } = state;

  // Handle multi-cursor
  if (selection instanceof MultiSelection) {
    return canTabEscapeMulti(state);
  }

  const { from, to } = selection;

  // Only handle cursor, not selection
  if (from !== to) return null;

  // Check for link first (higher priority)
  if (isInLink(state)) {
    const endPos = getLinkEndPos(state);
    if (endPos !== null && endPos > from) {
      return { type: "link", targetPos: endPos };
    }
    // Cursor is at the end of a link (e.g., last word in paragraph).
    // getLinkEndPos returns null because pos === childEnd, or endPos === from.
    // Return current position — the Tab handler will clear stored marks
    // so subsequent typing is no longer linked.
    return { type: "link", targetPos: from };
  }

  // Check for escapable mark
  if (isInEscapableMark(state)) {
    const endPos = getMarkEndPos(state);
    /* v8 ignore next -- @preserve false branch unreachable: when isInEscapableMark is true, getMarkEndPos always returns a valid position >= from */
    if (endPos !== null && endPos >= from) {
      return { type: "mark", targetPos: endPos };
    }
  }

  return null;
}
