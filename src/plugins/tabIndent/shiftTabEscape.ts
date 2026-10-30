/**
 * Shift+Tab Left-Escape for WYSIWYG Mode
 *
 * Purpose: Detects when cursor is inside an inline mark (bold, italic, code, strike)
 * or a link, and provides target position for Shift+Tab to jump to the start.
 * Mirrors tabEscape.ts (right-escape) in reverse direction.
 *
 * Pipeline: Shift+Tab pressed → check marks first (innermost-first) → storedMarks/nodeAfter
 *   fallback for left-boundary detection → then links → return start position
 *
 * Key decisions:
 *   - Marks checked before links (innermost-first principle — opposite of Tab)
 *   - Works from anywhere inside a mark/link (not just boundary)
 *   - Left-boundary fallback: $pos.marks() returns preceding node's marks, so at the
 *     left boundary of a code span with non-code content before it, marks() returns [].
 *     Single-cursor uses state.storedMarks (set by inlineCodeBoundary plugin);
 *     multi-cursor uses nodeAfter.marks directly (storedMarks is per-state, not per-cursor).
 *     Both escape to pos - 1 to avoid re-triggering inlineCodeBoundary.
 *   - Multi-cursor support: each cursor processed independently
 *   - Imports the ESCAPABLE_MARKS set from tabEscape.ts, so Tab and Shift+Tab escape the same marks
 *   - Mark boundary uses `<=` (cursor at mark end still has mark active)
 *   - Link boundary uses `<` (cursor at link end is at boundary where link may not be active;
 *     falls back to returning current pos for stored-mark clearing)
 *
 * @coordinates-with tabEscape.ts — owns ESCAPABLE_MARKS, mirrors structure
 * @coordinates-with tiptap.ts — wired into Shift+Tab handler chain
 * @module plugins/tabIndent/shiftTabEscape
 */

import type { EditorState } from "@tiptap/pm/state";
import type { Node as PMNode, MarkType, ResolvedPos } from "@tiptap/pm/model";
import { SelectionRange } from "@tiptap/pm/state";
import { MultiSelection } from "@/plugins/shared/MultiSelection";
import { ESCAPABLE_MARKS } from "./tabEscape";

export interface ShiftTabEscapeResult {
  type: "mark" | "link";
  targetPos: number;
}

/**
 * Find the start position of the inline child node at `pos` that matches `predicate`.
 *
 * @param parent    - The parent node containing inline children
 * @param parentStart - Absolute position of the parent's content start
 * @param pos       - Cursor position to locate
 * @param inclusive - If true, use `<= childEnd` (marks); if false, use `< childEnd` (links)
 * @param predicate - Test whether the child's marks qualify
 * @returns childStart if found, null otherwise
 */
function findChildStartAtPos(
  parent: PMNode,
  parentStart: number,
  pos: number,
  inclusive: boolean,
  predicate: (child: PMNode) => boolean,
): number | null {
  let offset = 0;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childStart = parentStart + offset;
    const childEnd = childStart + child.nodeSize;

    const inRange = inclusive
      ? pos >= childStart && pos <= childEnd
      : pos >= childStart && pos < childEnd;

    if (inRange && predicate(child)) {
      return childStart;
    }

    offset += child.nodeSize;
  }
  return null;
}

/** Predicate: child has a mark matching the given MarkType */
function hasMarkType(markType: MarkType): (child: PMNode) => boolean {
  /* v8 ignore next -- @preserve inline predicate always called when mark is present */
  return (child) => child.marks.some((m) => m.type === markType);
}

/** Predicate: child has a link mark */
function hasLinkMark(child: PMNode): boolean {
  /* v8 ignore next -- @preserve inline predicate always called when link is present */
  return child.marks.some((m) => m.type.name === "link");
}

/** Resolve a position and return parent + parentStart for child scanning */
function resolveParent($pos: ResolvedPos): { parent: PMNode; parentStart: number } {
  return { parent: $pos.parent, parentStart: $pos.start() };
}

/**
 * Get the start position of the text node containing the cursor
 * that has an escapable mark. Returns null if cursor has no escapable mark.
 */
export function getMarkStartPos(state: EditorState): number | null {
  const { selection } = state;
  const { from, to, $from } = selection;

  if (from !== to) return null;

  const escapableMark = $from.marks().find((m) => ESCAPABLE_MARKS.has(m.type.name));
  if (!escapableMark) return null;

  const { parent, parentStart } = resolveParent($from);
  return findChildStartAtPos(parent, parentStart, from, true, hasMarkType(escapableMark.type));
}

/**
 * Get the start position of the text node containing the cursor
 * that has a link mark. Returns null if cursor has no link mark.
 */
export function getLinkStartPos(state: EditorState): number | null {
  const { selection } = state;
  const { from, to, $from } = selection;

  if (from !== to) return null;

  const linkMark = $from.marks().find((m) => m.type.name === "link");
  if (!linkMark) return null;

  const { parent, parentStart } = resolveParent($from);
  const result = findChildStartAtPos(parent, parentStart, from, false, hasLinkMark);

  // Cursor at link boundary — return current position for stored-mark clearing
  return result ?? from;
}

/**
 * Calculate left-escape position for a single cursor position.
 * Checks marks first (innermost-first), then links.
 */
function calculateLeftEscapeForPosition(
  state: EditorState,
  pos: number,
): number | null {
  const $pos = state.doc.resolve(pos);

  // Check for escapable mark first (innermost-first — opposite of Tab)
  const escapableMark = $pos.marks().find((m) => ESCAPABLE_MARKS.has(m.type.name));
  if (escapableMark) {
    const { parent, parentStart } = resolveParent($pos);
    const result = findChildStartAtPos(parent, parentStart, pos, true, hasMarkType(escapableMark.type));
    /* v8 ignore next -- @preserve reason: findChildStartAtPos always returns a value when escapableMark is found at $pos; defensive guard */
    if (result !== null) return result;
  }

  // Fallback: check nodeAfter for the left-boundary case (same issue as single-cursor).
  // $pos.marks() returns the preceding node's marks. At the left boundary of a code span
  // with non-code content before it, marks() returns [] even though nodeAfter has the mark.
  // Unlike single-cursor canShiftTabEscape which uses state.storedMarks, multi-cursor
  // positions don't have individual storedMarks — check nodeAfter directly.
  if (
    $pos.textOffset === 0 &&
    $pos.nodeAfter &&
    pos > $pos.start()
  ) {
    const nodeAfterMark = $pos.nodeAfter.marks.find((m) => ESCAPABLE_MARKS.has(m.type.name));
    if (nodeAfterMark) {
      return pos - 1;
    }
  }

  // Check for link
  const linkMark = $pos.marks().find((m) => m.type.name === "link");
  if (linkMark) {
    const { parent, parentStart } = resolveParent($pos);
    const result = findChildStartAtPos(parent, parentStart, pos, false, hasLinkMark);
    // Cursor at link boundary — return pos for stored-mark clearing
    return result ?? pos;
  }

  return null;
}

/**
 * Determine if Shift+Tab can left-escape from current position.
 *
 * For single cursor:
 * 1. If in an escapable mark (bold/italic/code/strike), escape the mark
 * 2. If in a link, escape the link
 *
 * For multi-cursor: use canShiftTabEscapeMulti instead.
 *
 * @returns ShiftTabEscapeResult or null if Shift+Tab shouldn't escape
 */
export function canShiftTabEscape(state: EditorState): ShiftTabEscapeResult | MultiSelection | null {
  const { selection } = state;

  // Handle multi-cursor
  if (selection instanceof MultiSelection) {
    return canShiftTabEscapeMulti(state);
  }

  const { from, to, $from } = selection;

  if (from !== to) return null;

  // Check for escapable mark first (marks before links — innermost first)
  const escapableMark = $from.marks().find((m) => ESCAPABLE_MARKS.has(m.type.name));
  if (escapableMark) {
    const startPos = getMarkStartPos(state);
    /* v8 ignore next -- @preserve false branch unreachable: when escapableMark is found, getMarkStartPos always returns non-null */
    if (startPos !== null) {
      return { type: "mark", targetPos: startPos };
    }
  }

  // Fallback: check storedMarks for the left-boundary-of-code case.
  // $from.marks() returns the preceding node's marks. When cursor is at the exact
  // left boundary of a code span with non-code content before it, marks() returns []
  // even though the code mark applies to the next node. The inlineCodeBoundary plugin
  // detects this and sets state.storedMarks — check that here.
  if (state.storedMarks) {
    const storedEscapable = state.storedMarks.find((m) => ESCAPABLE_MARKS.has(m.type.name));
    if (
      storedEscapable &&
      $from.textOffset === 0 &&
      $from.nodeAfter?.marks.some((m) => m.type === storedEscapable.type) &&
      from > $from.start()
    ) {
      // Move one position left (into preceding content) to exit the code boundary.
      // Staying at `from` would re-trigger inlineCodeBoundary and re-add the mark.
      return { type: "mark", targetPos: from - 1 };
    }
  }

  // Check for link
  const linkMark = $from.marks().find((m) => m.type.name === "link");
  if (linkMark) {
    const startPos = getLinkStartPos(state);
    /* v8 ignore next -- @preserve false branch unreachable: when linkMark is found, getLinkStartPos always returns non-null */
    if (startPos !== null) {
      return { type: "link", targetPos: startPos };
    }
  }

  return null;
}

/**
 * Handle multi-cursor Shift+Tab left-escape.
 * Each cursor processed independently — only escapable cursors move.
 */
export function canShiftTabEscapeMulti(state: EditorState): MultiSelection | null {
  const { selection } = state;

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

    const escapePos = calculateLeftEscapeForPosition(state, $from.pos);

    if (escapePos !== null) {
      const $newPos = state.doc.resolve(escapePos);
      newRanges.push(new SelectionRange($newPos, $newPos));
      hasAnyEscape = true;
    } else {
      newRanges.push(range);
    }
  }

  if (!hasAnyEscape) {
    return null;
  }

  return new MultiSelection(newRanges, selection.primaryIndex);
}
