/**
 * Purpose: Shared utility helpers for the editor keymap plugin.
 *
 * Exports:
 * - escapeMarkBoundary: Escape out of inline marks at boundaries
 * - toProseMirrorKey: Convert shortcut store format to ProseMirror key format
 * - bindIfKey: Conditionally bind a shortcut key to a command
 * - wrapWithMultiSelectionGuard: Guard a command with multi-selection policy
 *
 * @coordinates-with editorPlugins.tiptap.ts (main keymap builder)
 * @coordinates-with shortcutsStore.ts (shortcut key format)
 * @coordinates-with multiSelectionPolicy.ts (multi-selection guard)
 */

import { Selection, type Command } from "@tiptap/pm/state";
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
    $from as unknown as Parameters<typeof findAnyMarkRangeAtCursor>[1]
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
