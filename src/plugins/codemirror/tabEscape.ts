/**
 * Tab Escape Plugin for CodeMirror
 *
 * Purpose: Allows Tab key to jump over closing brackets, quotes, and markdown
 * formatting characters — and to navigate through markdown link fields.
 *
 * Key decisions:
 *   - Link navigation is prioritized: Tab in [text] jumps to (url), Tab in (url) jumps out
 *   - Double format chars (**, ~~, ==) are jumped as a unit
 *   - CJK closing brackets are included in the jump-over set
 *   - Falls through to other Tab handlers if no escapable char is found
 *
 * @coordinates-with tabEscapeLink.ts — markdown link field navigation logic
 * @coordinates-with tabIndent.ts — fallback Tab handler (insert spaces)
 * @module plugins/codemirror/tabEscape
 */

import { KeyBinding, EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { tabNavigateLink, getLinkBoundaries, isInLinkText, isInLinkUrl } from "./tabEscapeLink";

// Closing characters that Tab can jump over
const CLOSING_CHARS = new Set([
  ")", "]", "}", '"', "'", "`", ">",
  // Markdown format chars (single)
  "*", "_", "^",
  // CJK closing brackets
  "）", "】", "」", "』", "》", "〉",
  // Curly quotes
  "\u201D", "\u2019", // " '
]);

// Multi-char closing sequences that Tab can jump over
const CLOSING_SEQUENCES = ["~~", "=="];

/**
 * Calculate escape position for a single cursor position.
 * Returns the target position or null if cursor cannot escape.
 */
function calculateEscapeForCursor(view: EditorView, pos: number): number | null {
  const { state } = view;

  // Try link navigation first
  const line = state.doc.lineAt(pos);
  const posInLine = pos - line.from;
  const boundaries = getLinkBoundaries(line.text, posInLine);

  if (boundaries) {
    let targetPosInLine: number | null = null;

    if (isInLinkText(boundaries, posInLine)) {
      // In text portion: jump to URL start
      targetPosInLine = boundaries.urlStart;
    } else if (isInLinkUrl(boundaries, posInLine)) {
      // In URL portion: jump after the link
      targetPosInLine = boundaries.linkEnd;
    }

    if (targetPosInLine !== null) {
      return line.from + targetPosInLine;
    }
  }

  // Check for multi-char closing sequences (~~, ==)
  const nextTwo = state.doc.sliceString(pos, pos + 2);
  for (const seq of CLOSING_SEQUENCES) {
    if (nextTwo === seq) {
      return pos + seq.length;
    }
  }

  // Check if next char is a closing bracket/quote
  const nextChar = state.doc.sliceString(pos, pos + 1);
  if (CLOSING_CHARS.has(nextChar)) {
    return pos + 1;
  }

  return null;
}

/**
 * Handle multi-cursor tab escape.
 * Processes each cursor independently and returns true if any cursor escaped.
 */
function handleMultiCursorEscape(view: EditorView): boolean {
  const { state } = view;
  const { ranges } = state.selection;

  // Only handle multi-cursor
  if (ranges.length <= 1) return false;

  const newRanges: { anchor: number; head?: number }[] = [];
  let hasAnyEscape = false;

  for (const range of ranges) {
    const { from, to } = range;

    // Only process cursors, not selections
    if (from !== to) {
      newRanges.push({ anchor: from, head: to });
      continue;
    }

    // Calculate escape position for this cursor
    const escapePos = calculateEscapeForCursor(view, from);

    if (escapePos !== null) {
      // Can escape - move cursor to escape position
      newRanges.push({ anchor: escapePos });
      hasAnyEscape = true;
    } else {
      // Cannot escape - keep cursor in place
      newRanges.push({ anchor: from });
    }
  }

  // Only dispatch if at least one cursor escaped
  if (!hasAnyEscape) {
    return false;
  }

  view.dispatch({
    selection: EditorSelection.create(
      newRanges.map((r) => EditorSelection.range(r.anchor, r.head ?? r.anchor))
    ),
    scrollIntoView: true,
  });

  return true;
}

/**
 * Tab key handler with multiple behaviors:
 * 1. Link navigation: [text] -> (url) -> outside
 * 2. Jump over closing bracket/quote if cursor is before one
 *
 * For multi-cursor:
 * - Each cursor is processed independently
 * - Cursors that can escape move to appropriate positions
 * - Cursors that cannot escape stay in place
 *
 * Falls through to default Tab behavior (indent) otherwise.
 */
export const tabEscapeKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Tab",
  run: (view) => {
    const { state } = view;

    // Handle multi-cursor first
    if (state.selection.ranges.length > 1) {
      return handleMultiCursorEscape(view);
    }

    const { from, to } = state.selection.main;

    // Only handle when no selection
    if (from !== to) return false;

    // Try link navigation first
    if (tabNavigateLink(view)) {
      return true;
    }

    // Check for multi-char closing sequences first (~~, ==)
    const nextTwo = state.doc.sliceString(from, from + 2);
    for (const seq of CLOSING_SEQUENCES) {
      if (nextTwo === seq) {
        view.dispatch({
          selection: { anchor: from + seq.length },
          scrollIntoView: true,
        });
        return true;
      }
    }

    // Check if next char is a closing bracket/quote
    const nextChar = state.doc.sliceString(from, from + 1);
    if (CLOSING_CHARS.has(nextChar)) {
      // Move cursor past the closing char
      view.dispatch({
        selection: { anchor: from + 1 },
        scrollIntoView: true,
      });
      return true;
    }

    return false; // Let default Tab handle it
  },
});
