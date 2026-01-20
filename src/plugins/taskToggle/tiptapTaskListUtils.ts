import type { Editor as TiptapEditor } from "@tiptap/core";
import { liftListItem } from "@tiptap/pm/schema-list";

/**
 * Check if the current selection is inside a task list.
 * A task list is a bulletList where listItem nodes have a `checked` attribute.
 */
function isInTaskList(editor: TiptapEditor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const listItemType = state.schema.nodes.listItem;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === listItemType) {
      const checked = node.attrs.checked as unknown;
      if (checked === true || checked === false) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Remove list formatting from the current selection.
 * Lifts list items until no longer in a list.
 */
function removeTaskList(editor: TiptapEditor): void {
  const { state, view } = editor;
  const listItemType = state.schema.nodes.listItem;
  if (!listItemType) return;

  const maxLifts = 10;
  for (let i = 0; i < maxLifts; i++) {
    const { $from } = view.state.selection;
    let inList = false;
    for (let d = $from.depth; d > 0; d--) {
      const name = $from.node(d).type.name;
      if (name === "bulletList" || name === "orderedList") {
        inList = true;
        break;
      }
    }
    if (!inList) break;
    liftListItem(listItemType)(view.state, view.dispatch);
  }
  view.focus();
}

/**
 * Toggle task list: if already in a task list, remove it; otherwise create one.
 */
export function toggleTaskList(editor: TiptapEditor): void {
  if (isInTaskList(editor)) {
    removeTaskList(editor);
    return;
  }
  convertSelectionToTaskList(editor);
}

export function convertSelectionToTaskList(editor: TiptapEditor): void {
  const { state, view } = editor;
  const bulletListType = state.schema.nodes.bulletList;
  const listItemType = state.schema.nodes.listItem;

  if (!bulletListType || !listItemType) {
    editor.chain().focus().toggleBulletList().run();
    return;
  }

  const { $from } = state.selection;
  let listDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "bulletList" || name === "orderedList") {
      listDepth = d;
      break;
    }
  }

  if (listDepth === -1) {
    editor.chain().focus().toggleBulletList().run();
    const { $from: $after } = editor.state.selection;
    for (let d = $after.depth; d > 0; d--) {
      const node = $after.node(d);
      if (node.type !== listItemType) continue;
      const pos = $after.before(d);
      const checked = node.attrs.checked as unknown;
      if (checked === true || checked === false) return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false }));
      view.focus();
      return;
    }
    return;
  }

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

  view.dispatch(tr);
  view.focus();
}

