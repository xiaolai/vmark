/**
 * Structural Character Protection
 *
 * Purpose: Prevents accidental deletion of structural markdown characters (table pipes,
 * list markers, blockquote markers) by intercepting Backspace/Delete at those positions.
 *
 * Key decisions:
 *   - Backspace at a table pipe skips over it (moves cursor) instead of deleting
 *   - Backspace at a list marker removes the entire marker (semantic operation)
 *   - Blockquote markers (>) are protected at the start of lines
 *   - Protection is disabled inside fenced code blocks — fence content is raw
 *     code, so "- ", "|", and "> " are data, not markers. The fence check is
 *     per cursor position (multi-cursor safe) and runs only after a structural
 *     match, so plain-text keystrokes never pay the fence scan.
 *   - Detection patterns/probes live in structuralCharDetection.ts and are
 *     re-exported here for existing importers (e.g. listSmartIndent)
 *
 * @coordinates-with structuralCharDetection.ts — patterns and position probes
 * @coordinates-with sourceContextDetection/codeFenceDetection.ts — fence guard
 * @coordinates-with listSmartIndent.ts — reuses LIST_ITEM_PATTERN, TASK_ITEM_PATTERN
 * @coordinates-with tableTabNav.ts — both operate on table structure
 * @module plugins/codemirror/structuralCharProtection
 */

import { type KeyBinding, type EditorView } from "@codemirror/view";
import { EditorState, EditorSelection, findClusterBreak, type ChangeSpec, type SelectionRange } from "@codemirror/state";
import { guardCodeMirrorKeyBinding } from "@/utils/imeGuard";
import { isPipeInCodeSpan } from "@/utils/tableParser";
import { getCodeFenceInfoAt } from "@/plugins/sourceContextDetection/codeFenceDetection";
import {
  TABLE_ROW_PATTERN,
  LIST_ITEM_PATTERN,
  TASK_ITEM_PATTERN,
  BLOCKQUOTE_PATTERN,
  isPipeEscaped,
  getCellStartPipePosAt,
  getListMarkerRangeAt,
  getTaskMarkerRangeAt,
  getBlockquoteMarkerInfoAt,
} from "./structuralCharDetection";

// Re-export from the historical home of these symbols so existing import
// paths (listSmartIndent, tests) stay stable after the file split.
export {
  TABLE_ROW_PATTERN,
  LIST_ITEM_PATTERN,
  TASK_ITEM_PATTERN,
  BLOCKQUOTE_PATTERN,
  getCellStartPipePos,
  getListMarkerRange,
  getTaskMarkerRange,
  getBlockquoteMarkerInfo,
} from "./structuralCharDetection";

/**
 * Compute backspace change for a list/task marker: outdent if indented, remove at level 0.
 * Returns { changes, range } for use with changeByRange.
 */
function backspaceMarkerSpec(
  state: EditorState,
  head: number,
  marker: { from: number; to: number; indent: number }
): { changes: ChangeSpec; range: SelectionRange } {
  if (marker.indent > 0) {
    const line = state.doc.lineAt(head);
    const tabSize = state.facet(EditorState.tabSize);
    const removeCount = Math.min(marker.indent, tabSize);
    return {
      changes: { from: line.from, to: line.from + removeCount },
      range: EditorSelection.cursor(head - removeCount),
    };
  }
  return {
    changes: { from: marker.from, to: marker.to },
    range: EditorSelection.cursor(marker.from),
  };
}

/**
 * Compute backspace change for a blockquote marker.
 * Returns { changes, range } for use with changeByRange.
 */
function backspaceBlockquoteSpec(
  state: EditorState,
  head: number,
  info: { markerEnd: number; depth: number }
): { changes: ChangeSpec; range: SelectionRange } | null {
  const line = state.doc.lineAt(head);
  const match = line.text.match(BLOCKQUOTE_PATTERN);
  /* v8 ignore next -- @preserve else branch: match always succeeds when getBlockquoteMarkerInfo returns non-null */
  if (!match) return null;

  if (info.depth > 1) {
    const newText = match[1] + ">".repeat(info.depth - 1) + " ";
    return {
      changes: { from: line.from, to: line.from + match[0].length, insert: newText },
      range: EditorSelection.cursor(line.from + newText.length),
    };
  }
  return {
    changes: { from: line.from, to: line.from + match[0].length },
    range: EditorSelection.cursor(line.from),
  };
}

/**
 * Fence guard: nullify a structural spec when the cursor sits inside a
 * fenced code block — there "- ", "|", and "> " are raw code, and protection
 * would corrupt it (e.g. backspace after "- " in a ```yaml fence must delete
 * one char, not the whole marker). Evaluated per cursor position so mixed
 * fence/non-fence multi-cursors behave independently.
 */
function guardCodeFence(
  spec: { changes: ChangeSpec; range: SelectionRange } | null,
  state: EditorState,
  head: number
): { changes: ChangeSpec; range: SelectionRange } | null {
  if (spec && getCodeFenceInfoAt(state, head) !== null) return null;
  return spec;
}

/**
 * Compute the backspace change spec for a single cursor position.
 * Returns null if the position is not at a structural character.
 */
function structuralBackspaceSpec(
  state: EditorState, head: number
): { changes: ChangeSpec; range: SelectionRange } | null {
  const pipePos = getCellStartPipePosAt(state, head);
  if (pipePos >= 0) {
    return { changes: [], range: EditorSelection.cursor(pipePos) };
  }

  const taskMarker = getTaskMarkerRangeAt(state, head);
  if (taskMarker) return backspaceMarkerSpec(state, head, taskMarker);

  const listMarker = getListMarkerRangeAt(state, head);
  if (listMarker) return backspaceMarkerSpec(state, head, listMarker);

  const bqInfo = getBlockquoteMarkerInfoAt(state, head);
  if (bqInfo) return backspaceBlockquoteSpec(state, head, bqInfo);

  return null;
}

/** Fence-guarded backspace spec for a single cursor position. */
function backspaceSpecForCursor(
  state: EditorState, head: number
): { changes: ChangeSpec; range: SelectionRange } | null {
  return guardCodeFence(structuralBackspaceSpec(state, head), state, head);
}

/**
 * Smart backspace handler that protects structural characters.
 * Processes each cursor independently for multi-cursor support.
 * Exported for testing.
 */
export function smartBackspace(view: EditorView): boolean {
  const { state } = view;
  const { ranges } = state.selection;

  // When there's a selection, let default behavior handle it
  if (ranges.some(r => !r.empty)) return false;

  // Check if any cursor is at a structural position
  let anyStructural = false;
  for (const range of ranges) {
    if (range.head > 0 && backspaceSpecForCursor(state, range.head)) {
      anyStructural = true;
      break;
    }
  }
  if (!anyStructural) return false;

  view.dispatch(
    state.changeByRange(range => {
      const { head } = range;
      if (head === 0) return { range };

      const spec = backspaceSpecForCursor(state, head);
      if (spec) return spec;

      // Non-structural cursor: apply default single-char backspace
      // Use findClusterBreak to respect surrogate pairs / grapheme clusters
      const prevPos = findClusterBreak(state.doc.toString(), head, false);
      return {
        changes: { from: prevPos, to: head },
        range: EditorSelection.cursor(prevPos),
      };
    }),
    { scrollIntoView: true }
  );

  return true;
}

/**
 * Compute the delete change spec for a single cursor position.
 * Returns null if the position is not at a structural character.
 */
function structuralDeleteSpec(
  state: EditorState, head: number
): { changes: ChangeSpec; range: SelectionRange } | null {
  if (head >= state.doc.length) return null;

  const line = state.doc.lineAt(head);
  const offsetInLine = head - line.from;

  // Check if we're about to delete into a pipe that is actually a structural
  // delimiter (not an escaped pipe and not inside an inline code span).
  const charAfter = line.text[offsetInLine];
  if (
    charAfter === "|" &&
    TABLE_ROW_PATTERN.test(line.text) &&
    !isPipeInCodeSpan(line.text, offsetInLine)
  ) {
    // Don't protect escaped pipes (\|) — they are cell content, not delimiters
    if (isPipeEscaped(line.text, offsetInLine)) return null;
    return { changes: [], range: EditorSelection.cursor(head + 1) };
  }

  // At end of line, forward-deleting would merge with next line —
  // protect structural markers on the next line by skipping over them
  if (head === line.to && line.number < state.doc.lines) {
    const nextLine = state.doc.line(line.number + 1);

    if (TABLE_ROW_PATTERN.test(nextLine.text)) {
      return { changes: [], range: EditorSelection.cursor(nextLine.from) };
    }

    const taskMatch = nextLine.text.match(TASK_ITEM_PATTERN);
    if (taskMatch) {
      return { changes: [], range: EditorSelection.cursor(nextLine.from + taskMatch[0].length) };
    }

    const listMatch = nextLine.text.match(LIST_ITEM_PATTERN);
    if (listMatch) {
      return { changes: [], range: EditorSelection.cursor(nextLine.from + listMatch[0].length) };
    }

    const blockquoteMatch = nextLine.text.match(BLOCKQUOTE_PATTERN);
    if (blockquoteMatch) {
      return { changes: [], range: EditorSelection.cursor(nextLine.from + blockquoteMatch[0].length) };
    }
  }

  return null;
}

/** Fence-guarded delete spec for a single cursor position. */
function deleteSpecForCursor(
  state: EditorState, head: number
): { changes: ChangeSpec; range: SelectionRange } | null {
  return guardCodeFence(structuralDeleteSpec(state, head), state, head);
}

/**
 * Smart delete handler that protects structural characters.
 * Processes each cursor independently for multi-cursor support.
 * Exported for testing.
 */
export function smartDelete(view: EditorView): boolean {
  const { state } = view;
  const { ranges } = state.selection;

  // When there's a selection, let default behavior handle it
  if (ranges.some(r => !r.empty)) return false;

  // Check if any cursor is at a structural position
  let anyStructural = false;
  for (const range of ranges) {
    if (deleteSpecForCursor(state, range.head)) {
      anyStructural = true;
      break;
    }
  }
  if (!anyStructural) return false;

  view.dispatch(
    state.changeByRange(range => {
      const { head } = range;

      const spec = deleteSpecForCursor(state, head);
      if (spec) return spec;

      // Non-structural cursor: apply default single-char delete
      // Use findClusterBreak to respect surrogate pairs / grapheme clusters
      if (head >= state.doc.length) return { range };
      const nextPos = findClusterBreak(state.doc.toString(), head, true);
      return {
        changes: { from: head, to: nextPos },
        range: EditorSelection.cursor(head),
      };
    }),
    { scrollIntoView: true }
  );

  return true;
}

/**
 * Keybinding for protected backspace.
 */
export const structuralBackspaceKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Backspace",
  run: smartBackspace,
});

/**
 * Keybinding for protected delete.
 */
export const structuralDeleteKeymap: KeyBinding = guardCodeMirrorKeyBinding({
  key: "Delete",
  run: smartDelete,
});
