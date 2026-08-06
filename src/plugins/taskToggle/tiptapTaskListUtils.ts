/**
 * Task List Utilities
 *
 * Purpose: Provides toggle and un-toggle commands for converting between regular
 * bullet lists and task lists. Handles the tricky edge cases of lifting task items
 * back to regular lists and toggling checked attributes.
 *
 * @coordinates-with tiptap.ts — the task toggle extension uses these for toolbar commands
 * @coordinates-with toolbarActions — toolbar adapter calls toggleTaskList/convertSelectionToTaskList
 * @module plugins/taskToggle/tiptapTaskListUtils
 */
import type { Editor as TiptapEditor } from "@tiptap/core";
import { liftSelectionOutOfLists } from "@/plugins/shared/listHelpers";

/**
 * Check if the current selection is inside a task list. Decided at the
 * NEAREST enclosing listItem only: the item must carry a boolean `checked`
 * AND live in a bulletList. Walking further up would misclassify a plain
 * list nested inside a task item (and flatten it), and a stale `checked` on
 * an ordered-list item is not a task either.
 */
function isInTaskList(editor: TiptapEditor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const listItemType = state.schema.nodes.listItem;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === listItemType) {
      const checked = node.attrs.checked as unknown;
      const parentIsBullet = d > 1 && $from.node(d - 1).type.name === "bulletList";
      return (checked === true || checked === false) && parentIsBullet;
    }
  }
  return false;
}

/**
 * Clear the checked attribute from the current list item before lifting.
 */
function clearCheckedAttribute(editor: TiptapEditor): void {
  const { state, view } = editor;
  const listItemType = state.schema.nodes.listItem;
  if (!listItemType) return;

  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === listItemType) {
      const checked = node.attrs.checked;
      if (checked === true || checked === false) {
        const pos = $from.before(d);
        const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: null });
        tr.setMeta("addToHistory", true);
        view.dispatch(tr);
      }
      break;
    }
  }
}

/**
 * Remove list formatting from the current selection.
 * Lifts list items until no longer in a list (shared primitive — stops on a
 * failed lift instead of retrying it). Clears the checked attribute before
 * each lift to prevent stale task state.
 */
function removeTaskList(editor: TiptapEditor): boolean {
  const { view } = editor;
  const lifted = liftSelectionOutOfLists(view, () => clearCheckedAttribute(editor));
  view.focus();
  return lifted;
}

/**
 * Toggle task list: if already in a task list, remove it; otherwise create
 * one. Returns whether the document changed (B2 boolean contract).
 */
export function toggleTaskList(editor: TiptapEditor): boolean {
  if (isInTaskList(editor)) {
    return removeTaskList(editor);
  }
  return convertSelectionToTaskList(editor);
}

/** Depth of the nearest list ancestor of `$from`, or -1. */
function nearestListDepth($from: TiptapEditor["state"]["selection"]["$from"]): number {
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "bulletList" || name === "orderedList") return d;
  }
  return -1;
}

/**
 * Convert the nearest list ancestor of the selection into a task list:
 * orderedList becomes bulletList, and EVERY direct listItem without a boolean
 * `checked` gains `checked: false` — all items, not only the one under the
 * cursor (wrapping a multi-paragraph selection creates several new items).
 * Dispatches only when something actually changes.
 */
function markNearestListAsTasks(editor: TiptapEditor): boolean {
  const { state, view } = editor;
  const bulletListType = state.schema.nodes.bulletList;
  const listItemType = state.schema.nodes.listItem;
  const { $from } = state.selection;

  const listDepth = nearestListDepth($from);
  if (listDepth === -1) return false; // wrap path: chain may not have created a list


  const listNode = $from.node(listDepth);
  const listPos = $from.before(listDepth);
  const tr = state.tr;

  if (listNode.type.name === "orderedList") {
    tr.setNodeMarkup(listPos, bulletListType);
  }

  listNode.forEach((item, offset) => {
    if (item.type !== listItemType) return;
    const checked = item.attrs.checked as unknown;
    if (checked === true || checked === false) return;
    tr.setNodeMarkup(listPos + 1 + offset, undefined, { ...item.attrs, checked: false });
  });

  // An already fully initialized task list produces no steps — honest no-op.
  if (tr.steps.length === 0) return false;
  tr.setMeta("addToHistory", true);
  view.dispatch(tr);
  view.focus();
  return true;
}

export function convertSelectionToTaskList(editor: TiptapEditor): boolean {
  const { state } = editor;
  const bulletListType = state.schema.nodes.bulletList;
  const listItemType = state.schema.nodes.listItem;

  if (!bulletListType || !listItemType) {
    return editor.chain().focus().toggleBulletList().run();
  }

  if (nearestListDepth(state.selection.$from) === -1) {
    // Not in a list: wrap first, then initialize every new item.
    const wrapped = editor.chain().focus().toggleBulletList().run();
    if (!wrapped) return false;
    return markNearestListAsTasks(editor) || wrapped;
  }

  return markNearestListAsTasks(editor);
}

