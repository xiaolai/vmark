/**
 * List Backspace Extension
 *
 * Overrides Backspace in list items to implement two-step removal:
 * 1. First Backspace at content start: lift item out of list (become paragraph)
 * 2. Second Backspace: standard paragraph joining (handled by defaultKeymap)
 *
 * Runs at priority 1000 (before ListKeymap at priority 0) so it intercepts
 * Backspace before the default joinItemBackward behavior fires.
 */

import { Extension, isAtStartOfNode } from "@tiptap/core";
import { keymap } from "@tiptap/pm/keymap";
import { liftListItem } from "@tiptap/pm/schema-list";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { guardProseMirrorCommand } from "@/utils/imeGuard";

function handleListBackspace(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  _view?: EditorView
): boolean {
  // Only handle empty (collapsed) selections
  if (!state.selection.empty) return false;

  const listItemType =
    state.schema.nodes["listItem"] ?? state.schema.nodes["list_item"];
  if (!listItemType) return false;

  // Check if cursor is inside a list item by walking up the resolved position
  const { $from } = state.selection;
  let inListItem = false;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === listItemType) {
      inListItem = true;
      break;
    }
  }
  if (!inListItem) return false;

  // Must be at start of node content (no chars before cursor in this textblock)
  if (!isAtStartOfNode(state)) return false;

  // Lift the list item out — converts to paragraph at same position
  return liftListItem(listItemType)(state, dispatch);
}

export const listBackspaceExtension = Extension.create({
  name: "listBackspace",
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      keymap({
        Backspace: guardProseMirrorCommand(handleListBackspace),
      }),
    ];
  },
});
