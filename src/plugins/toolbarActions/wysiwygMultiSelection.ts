/**
 * WYSIWYG Multi-Selection Block Actions
 *
 * Purpose: Applies block-level actions (heading, list, blockquote) across multiple
 * ProseMirror cursors. Iterates ranges in reverse document order to preserve
 * position validity as earlier ranges shift from edits.
 *
 * @coordinates-with wysiwygAdapter.ts — delegates here when MultiSelection is active
 * @coordinates-with multiCursor — provides MultiSelection and range utilities
 * @module plugins/toolbarActions/wysiwygMultiSelection
 */
import { TextSelection } from "@tiptap/pm/state";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { MultiSelection } from "@/plugins/multiCursor";
import { handleBlockquoteNest, handleBlockquoteUnnest, handleRemoveBlockquote, handleListIndent, handleListOutdent, handleRemoveList, handleToBulletList, handleToOrderedList } from "@/plugins/formatToolbar/nodeActions.tiptap";
import { convertSelectionToTaskList } from "@/plugins/taskToggle/tiptapTaskListUtils";

function forEachRangeDescending(
  view: EditorView,
  handler: (from: number, to: number) => boolean
): boolean {
  if (!(view.state.selection instanceof MultiSelection)) return false;
  const ranges = [...view.state.selection.ranges].sort((a, b) => b.$from.pos - a.$from.pos);
  let applied = false;
  for (const range of ranges) {
    applied = handler(range.$from.pos, range.$to.pos) || applied;
  }
  return applied;
}

function setSelection(view: EditorView, from: number, to: number) {
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to));
  view.dispatch(tr);
}

export function applyMultiSelectionHeading(
  view: EditorView,
  editor: TiptapEditor | null,
  level: number
): boolean {
  if (!editor) return false;
  return forEachRangeDescending(view, (from, to) => {
    setSelection(view, from, to);
    if (level === 0) {
      editor.chain().focus().setParagraph().run();
      return true;
    }
    editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    return true;
  });
}

export function applyMultiSelectionListAction(
  view: EditorView,
  action: string,
  editor?: TiptapEditor | null
): boolean {
  return forEachRangeDescending(view, (from, to) => {
    setSelection(view, from, to);
    switch (action) {
      case "bulletList":
        handleToBulletList(view);
        return true;
      case "orderedList":
        handleToOrderedList(view);
        return true;
      case "taskList":
        if (!editor) return false;
        convertSelectionToTaskList(editor);
        return true;
      case "indent":
        handleListIndent(view);
        return true;
      case "outdent":
        handleListOutdent(view);
        return true;
      case "removeList":
        handleRemoveList(view);
        return true;
      default:
        return false;
    }
  });
}

export function applyMultiSelectionBlockquoteAction(view: EditorView, action: string): boolean {
  return forEachRangeDescending(view, (from, to) => {
    setSelection(view, from, to);
    switch (action) {
      case "nestQuote":
        handleBlockquoteNest(view);
        return true;
      case "unnestQuote":
        handleBlockquoteUnnest(view);
        return true;
      case "removeQuote":
        handleRemoveBlockquote(view);
        return true;
      default:
        return false;
    }
  });
}
