import { Extension } from "@tiptap/core";
import { keymap } from "@tiptap/pm/keymap";
import { liftListItem, splitListItem } from "@tiptap/pm/schema-list";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { NodeType } from "@tiptap/pm/model";
import { guardProseMirrorCommand } from "@/utils/imeGuard";

function isListItemEmpty(state: EditorState, listItemType: NodeType): boolean {
  const { $from } = state.selection;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === listItemType) {
      return node.textContent.trim() === "";
    }
  }
  return false;
}

function handleListEnter(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  _view?: EditorView
): boolean {
  const listItemType = state.schema.nodes["listItem"] ?? state.schema.nodes["list_item"];
  if (!listItemType) return false;

  const { $from } = state.selection;

  let inListItem = false;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === listItemType) {
      inListItem = true;
      break;
    }
  }

  if (!inListItem) return false;

  if (isListItemEmpty(state, listItemType)) {
    return liftListItem(listItemType)(state, dispatch);
  }

  return splitListItem(listItemType)(state, dispatch);
}

export const listContinuationExtension = Extension.create({
  name: "listContinuation",
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      keymap({
        Enter: guardProseMirrorCommand(handleListEnter),
      }),
    ];
  },
});
