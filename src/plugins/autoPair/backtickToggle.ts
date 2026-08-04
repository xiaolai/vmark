/**
 * Backtick Code Mark Toggle
 *
 * Purpose: Handles backtick (`) input as a code mark toggle in WYSIWYG mode.
 * Uses a consecutive backtick state machine:
 *   - 1st backtick: activate code mark (or wrap selection / escape from code)
 *   - 2nd consecutive backtick: deactivate code mark (user changed their mind)
 *   - 3rd consecutive backtick: create code block
 *
 * Split from handlers.ts to keep files under ~300 lines.
 *
 * @coordinates-with handlers.ts — called from handleTextInput for backtick input;
 *   handlers.ts calls resetBacktickState() on non-backtick input.
 * @module plugins/autoPair/backtickToggle
 */

import type { EditorView } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import { isInCodeBlock } from "./utils";

// --- Consecutive backtick state machine ---
// Tracks consecutive backtick presses without intervening text input.
// 1 = code mark activated, 2 = code mark deactivated, 3 = create code block.
let consecutiveBackticks = 0;
let lastBacktickFrom = -1;
let resetTimeout: ReturnType<typeof setTimeout> | null = null;
const BACKTICK_RESET_DELAY = 500;

/** Reset consecutive backtick state. Called by handlers.ts on non-backtick input. */
export function resetBacktickState(): void {
  consecutiveBackticks = 0;
  lastBacktickFrom = -1;
  if (resetTimeout) {
    clearTimeout(resetTimeout);
    resetTimeout = null;
  }
}

function scheduleReset(): void {
  if (resetTimeout) clearTimeout(resetTimeout);
  resetTimeout = setTimeout(() => {
    consecutiveBackticks = 0;
    resetTimeout = null;
  }, BACKTICK_RESET_DELAY);
}

/**
 * Handle backtick as code mark toggle in WYSIWYG mode.
 * - Outside code: consecutive state machine (1=activate, 2=deactivate, 3=code block)
 * - Inside code: escape to end of code mark
 * - Selection: wrap with code mark
 * Returns true if handled.
 */
export function handleBacktickCodeToggle(
  view: EditorView,
  from: number,
  to: number
): boolean {
  const { state, dispatch } = view;

  // Don't handle if preceded by backslash (escaped)
  /* v8 ignore next -- @preserve reason: from is always >= 1 in ProseMirror (cursor is inside the doc node); the else branch (from === 0) is unreachable during normal editing */
  if (from > 0) {
    const $pos = state.doc.resolve(from);
    const textBefore = $pos.parent.textBetween(
      Math.max(0, $pos.parentOffset - 1),
      $pos.parentOffset,
      ""
    );
    if (textBefore === "\\") {
      resetBacktickState();
      return false;
    }
  }

  // Don't handle in code blocks
  if (isInCodeBlock(state)) {
    resetBacktickState();
    return false;
  }

  const codeMarkType = state.schema.marks.code;
  if (!codeMarkType) {
    resetBacktickState();
    return false;
  }

  // Check if cursor is in inline code (actual mark in document, not stored marks)
  const $from = state.doc.resolve(from);
  const inCode = $from.marks().some((m) => m.type === codeMarkType);

  if (inCode) {
    // Escape: move cursor to end of code mark (not part of consecutive counting)
    resetBacktickState();
    const endPos = findCodeMarkEnd(state, from, codeMarkType);
    /* v8 ignore next -- @preserve reason: endPos is always non-null when inCode is true; the ?? from fallback is structurally unreachable */
    const pos = endPos ?? from;
    const tr = state.tr.setSelection(TextSelection.create(state.doc, pos));
    tr.removeStoredMark(codeMarkType);
    dispatch(tr);
    return true;
  }

  // Selection: wrap with code mark (one-shot, not part of consecutive counting)
  if (from !== to) {
    resetBacktickState();
    const tr = state.tr.addMark(from, to, codeMarkType.create());
    dispatch(tr);
    return true;
  }

  // --- Consecutive backtick state machine ---
  // Reset if cursor moved since last backtick (e.g., user clicked elsewhere)
  if (consecutiveBackticks > 0 && from !== lastBacktickFrom) {
    resetBacktickState();
  }
  consecutiveBackticks++;
  lastBacktickFrom = from;
  scheduleReset();

  if (consecutiveBackticks === 1) {
    // First backtick: activate code mark
    const tr = state.tr.addStoredMark(codeMarkType.create());
    dispatch(tr);
    return true;
  }

  if (consecutiveBackticks === 2) {
    // Second backtick: deactivate code mark (user changed their mind)
    const tr = state.tr.removeStoredMark(codeMarkType);
    dispatch(tr);
    return true;
  }

  if (consecutiveBackticks === 3) {
    // Triple backtick: create code block
    resetBacktickState();
    const codeBlockType = state.schema.nodes.codeBlock;
    if (!codeBlockType) return false;
    const tr = state.tr.replaceSelectionWith(codeBlockType.create());
    dispatch(tr);
    return true;
  }

  return false;
}

/**
 * Find the end position of the code mark containing the given position.
 */
function findCodeMarkEnd(
  state: EditorState,
  pos: number,
  codeMarkType: ReturnType<EditorState["schema"]["marks"]["code"]["create"]>["type"]
): number | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const parentStart = $pos.start();

  let offset = 0;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childStart = parentStart + offset;
    const childEnd = childStart + child.nodeSize;

    if (pos >= childStart && pos <= childEnd) {
      /* v8 ignore next 3 -- @preserve reason: when inCode is true the cursor lies inside a code-marked text node; any sibling that satisfies the range check but lacks the code mark is only reachable at a mark boundary where $from.marks() already returns [] (inCode=false), making this else path structurally unreachable */
      if (child.marks.some((m) => m.type === codeMarkType)) {
        return childEnd;
      }
    }
    offset += child.nodeSize;
  }
  return null;
}
