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

// --- Consecutive backtick state machine, PER EDITOR VIEW ---
// Tracks consecutive backtick presses without intervening text input.
// 1 = code mark activated, 2 = code mark deactivated, 3 = create code block.
// Keyed by view: module-global state let two live editors corrupt each
// other's count (a first backtick in window A + one in window B read as B's
// second), and a destroyed editor left a shared timer alive (audit round 1).
interface BacktickState {
  consecutive: number;
  lastFrom: number;
  resetTimeout: ReturnType<typeof setTimeout> | null;
}
const states = new Map<EditorView, BacktickState>();
const BACKTICK_RESET_DELAY = 500;

function stateFor(view: EditorView): BacktickState {
  let s = states.get(view);
  if (!s) {
    s = { consecutive: 0, lastFrom: -1, resetTimeout: null };
    states.set(view, s);
  }
  return s;
}

/**
 * Reset consecutive backtick state — for one view (handlers.ts, on
 * non-backtick input) or for ALL views (test isolation, no argument).
 * Clearing also drops the map entry, so destroyed editors do not accumulate.
 */
export function resetBacktickState(view?: EditorView): void {
  const targets = view ? [view] : [...states.keys()];
  for (const v of targets) {
    const s = states.get(v);
    if (s?.resetTimeout) clearTimeout(s.resetTimeout);
    states.delete(v);
  }
}

function scheduleReset(view: EditorView): void {
  const s = stateFor(view);
  if (s.resetTimeout) clearTimeout(s.resetTimeout);
  // The timer DELETES the entry (not just the count): a Map has no
  // view-destruction hook, so entry lifetime is bounded by the reset delay —
  // a destroyed view is unreferenced within 500ms instead of retained
  // indefinitely (audit round 1 verify).
  s.resetTimeout = setTimeout(() => {
    states.delete(view);
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
      resetBacktickState(view);
      return false;
    }
  }

  // Don't handle in code blocks
  if (isInCodeBlock(state)) {
    resetBacktickState(view);
    return false;
  }

  const codeMarkType = state.schema.marks.code;
  if (!codeMarkType) {
    resetBacktickState(view);
    return false;
  }

  // Check if cursor is in inline code (actual mark in document, not stored marks)
  const $from = state.doc.resolve(from);
  const inCode = $from.marks().some((m) => m.type === codeMarkType);

  if (inCode) {
    // Escape: move cursor to end of code mark (not part of consecutive counting)
    resetBacktickState(view);
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
    resetBacktickState(view);
    const tr = state.tr.addMark(from, to, codeMarkType.create());
    dispatch(tr);
    return true;
  }

  // --- Consecutive backtick state machine ---
  // Reset if cursor moved since last backtick (e.g., user clicked elsewhere)
  if (stateFor(view).consecutive > 0 && from !== stateFor(view).lastFrom) {
    resetBacktickState(view);
  }
  const s = stateFor(view);
  s.consecutive++;
  s.lastFrom = from;
  scheduleReset(view);

  if (s.consecutive === 1) {
    // First backtick: activate code mark
    const tr = state.tr.addStoredMark(codeMarkType.create());
    dispatch(tr);
    return true;
  }

  if (s.consecutive === 2) {
    // Second backtick: deactivate code mark (user changed their mind)
    const tr = state.tr.removeStoredMark(codeMarkType);
    dispatch(tr);
    return true;
  }

  if (s.consecutive === 3) {
    // Triple backtick: create code block
    resetBacktickState(view);
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
