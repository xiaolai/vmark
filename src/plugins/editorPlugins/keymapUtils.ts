/**
 * Purpose: Shared utility helpers for the editor keymap plugin.
 *
 * Exports:
 * - escapeMarkBoundary: Escape out of inline marks at boundaries
 * - collapseNonEmptySelection: Collapse non-empty selection to cursor at head
 * - toProseMirrorKey: Convert shortcut store format to ProseMirror key format
 * - bindIfKey: Conditionally bind a shortcut key to a command
 * - wrapWithMultiSelectionGuard: Guard a command with multi-selection policy
 *
 * @coordinates-with editorPlugins.tiptap.ts (main keymap builder)
 * @coordinates-with shortcutsStore.ts (shortcut key format)
 * @coordinates-with multiSelectionPolicy.ts (multi-selection guard)
 */

import { Selection, TextSelection, type Command } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { guardProseMirrorCommand } from "@/utils/imeGuard";
import { canRunActionInMultiSelection } from "@/plugins/toolbarActions/multiSelectionPolicy";
import { getWysiwygMultiSelectionContext } from "@/plugins/toolbarActions/multiSelectionContext";
import { findAnyMarkRangeAtCursor } from "@/plugins/syntaxReveal/marks";

export function escapeMarkBoundary(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const { $from, empty } = selection;

  if (!empty) return false;

  const pos = $from.pos;
  const anyMarkRange = findAnyMarkRangeAtCursor(
    pos,
    $from
  );

  if (!anyMarkRange) {
    if (state.storedMarks && state.storedMarks.length > 0) {
      dispatch(state.tr.setStoredMarks([]));
      return true;
    }
    return false;
  }

  const { from: markFrom, to: markTo } = anyMarkRange;

  if (pos === markTo) {
    dispatch(state.tr.setStoredMarks([]));
    return true;
  }

  if (pos === markFrom) {
    if (markFrom > 1) {
      const tr = state.tr.setSelection(Selection.near(state.doc.resolve(markFrom - 1)));
      tr.setStoredMarks([]);
      dispatch(tr);
    } else {
      dispatch(state.tr.setStoredMarks([]));
    }
    return true;
  }

  const tr = state.tr.setSelection(Selection.near(state.doc.resolve(markTo)));
  tr.setStoredMarks([]);
  dispatch(tr);
  return true;
}

/**
 * Collapse a non-empty selection to a single cursor at the selection head.
 * Used by the Escape handler so a user can clear a range (e.g. the whole
 * document after Cmd+A) without typing or clicking.
 *
 * Returns false and leaves state untouched when:
 * - The selection is already empty (nothing to collapse).
 * - The selection has multiple ranges (multi-cursor), so the multi-cursor
 *   keymap's own Escape handler can reduce to the primary range first.
 */
export function collapseNonEmptySelection(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;

  if (selection.empty) return false;
  if (selection.ranges.length > 1) return false;

  // Selection.near() adjusts if `head` lands on a non-inline boundary (e.g.,
  // between atom blocks) so the resulting cursor always sits at a valid
  // text position.
  const collapsed = Selection.near(state.doc.resolve(selection.head));
  const tr = state.tr.setSelection(
    collapsed instanceof TextSelection ? collapsed : TextSelection.create(state.doc, selection.head)
  );
  dispatch(tr);
  return true;
}

/**
 * Convert shortcut key format to ProseMirror keymap format.
 * Shortcuts store uses normalized format (Up, Down, Left, Right)
 * but ProseMirror keydownHandler expects browser key names (ArrowUp, ArrowDown, etc.)
 */
export function toProseMirrorKey(key: string): string {
  return key
    .replace(/\bUp\b/g, "ArrowUp")
    .replace(/\bDown\b/g, "ArrowDown")
    .replace(/\bLeft\b/g, "ArrowLeft")
    .replace(/\bRight\b/g, "ArrowRight");
}

export function bindIfKey(binds: Record<string, Command>, key: string, command: Command) {
  if (!key) return;
  binds[toProseMirrorKey(key)] = guardProseMirrorCommand(command);
}

export function wrapWithMultiSelectionGuard(action: string, command: Command): Command {
  return (state, dispatch, view) => {
    if (!view) return false;
    const multi = getWysiwygMultiSelectionContext(view);
    if (!canRunActionInMultiSelection(action, multi)) return false;
    return command(state, dispatch, view);
  };
}
