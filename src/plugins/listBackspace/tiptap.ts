/**
 * List Backspace Extension
 *
 * Intercepts Backspace at the start of list items:
 *   - Empty list item → delete the entire listItem so the surrounding
 *     bulletList/orderedList stays contiguous (#790).
 *   - Non-empty list item at content start → lift item to paragraph
 *     (two-step removal: Backspace again falls through to default
 *     paragraph-join behavior).
 *
 * Uses `handleDOMEvents.keydown` rather than a ProseMirror keymap because
 * Tiptap's core Keymap extension (`addKeyboardShortcuts`) also binds
 * Backspace and runs earlier than extension-supplied keymaps. Its
 * `joinBackward` command succeeds for empty middle/last list items and
 * produces a split list with an empty paragraph between halves.
 * `handleDOMEvents.keydown` runs before any keymap, guaranteeing we
 * observe Backspace first and can short-circuit with `event.preventDefault`
 * + returning true.
 *
 * @coordinates-with shared/listHelpers.ts — shared list item lookup and ancestor walk
 */

import { Extension, isAtStartOfNode } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import { liftListItem } from "@tiptap/pm/schema-list";
import type { EditorView } from "@tiptap/pm/view";
import {
  findEnclosingListItem,
  findListItemType,
} from "@/plugins/shared/listHelpers";

function handleBackspaceKeydown(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== "Backspace") return false;
  // Let modifier combos (Alt+Backspace "delete word", etc.) and IME
  // compositions fall through to the default behavior.
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.isComposing) return false;

  const { state, dispatch } = view;
  if (!state.selection.empty) return false;

  const listItemType = findListItemType(state.schema);
  /* v8 ignore next -- @preserve defensive: schema always includes listItem in VMark */
  if (!listItemType) return false;

  const { $from } = state.selection;
  const enclosing = findEnclosingListItem($from, listItemType);
  if (!enclosing) return false;

  // Only act at the start of the textblock — preserve normal mid-text Backspace.
  if (!isAtStartOfNode(state)) return false;

  if (enclosing.node.textContent.trim() === "") {
    // Empty list item: delete the entire node so the list does not split
    // around a stray empty paragraph. TextSelection.near with bias -1
    // places the cursor at the end of the previous sibling list item
    // (or the nearest backward cursor position when none exists).
    const from = $from.before(enclosing.depth);
    const to = $from.after(enclosing.depth);
    const tr = state.tr.delete(from, to);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from), -1));
    dispatch(tr);
    event.preventDefault();
    return true;
  }

  // Non-empty list item at content start: lift to paragraph.
  const handled = liftListItem(listItemType)(state, dispatch);
  if (handled) event.preventDefault();
  return handled;
}

/** Tiptap extension that handles backspace at the start of list items. */
export const listBackspaceExtension = Extension.create({
  name: "listBackspace",
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            keydown: handleBackspaceKeydown,
          },
        },
      }),
    ];
  },
});
