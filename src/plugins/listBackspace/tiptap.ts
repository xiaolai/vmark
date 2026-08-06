/**
 * List Backspace Extension
 *
 * Intercepts Backspace at the start of list items:
 *   - Empty list item with siblings → delete the entire listItem so the
 *     surrounding bulletList/orderedList stays contiguous (#790).
 *   - SOLE empty list item → lift to paragraph instead: deleting the node
 *     would leave an empty list, which ProseMirror refills with a fresh empty
 *     item (bulletList requires `listItem+`), so the list would survive and
 *     the repositioned cursor would jump into the previous block.
 *   - Non-empty list item at content start → lift the item one level
 *     (top-level items become paragraphs; nested items outdent into the
 *     parent list). Two-step removal: Backspace again falls through to
 *     default paragraph-join behavior.
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
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import {
  isImeKeyEvent,
  isProseMirrorComposing,
  isProseMirrorInCompositionGrace,
} from "@/utils/imeGuard";
import {
  findEnclosingListItem,
  findListItemType,
} from "@/plugins/shared/listHelpers";

/**
 * True only for an item that is exactly one genuinely empty paragraph.
 * `textContent.trim() === ""` is NOT that: items holding only atoms (images,
 * media, inline math) or hard breaks also have empty text, and deleting them
 * would silently discard content.
 */
function isStructurallyEmptyItem(item: PMNode): boolean {
  if (item.childCount !== 1) return false;
  const first = item.child(0);
  return first.isTextblock && first.childCount === 0;
}

/** Run liftListItem and consume the Backspace when it applied. */
function liftAndConsumeBackspace(
  view: EditorView,
  listItemType: NonNullable<ReturnType<typeof findListItemType>>,
  event: KeyboardEvent
): boolean {
  const handled = liftListItem(listItemType)(view.state, view.dispatch);
  if (handled) event.preventDefault();
  return handled;
}

/** Exported for direct unit testing of interception decisions. */
export function handleBackspaceKeydown(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== "Backspace") return false;
  // Let modifier combos (Alt+Backspace "delete word", etc.) and IME
  // compositions fall through to the default behavior. `isComposing` alone
  // misses keyCode-229 events and the post-composition grace period that CJK
  // IMEs need — use the shared guards.
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (isImeKeyEvent(event)) return false;
  if (isProseMirrorComposing(view) || isProseMirrorInCompositionGrace(view)) return false;

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

  // Only act in the item's FIRST block: at the start of a second paragraph
  // inside the same item, default block joining is the right behavior.
  if ($from.index(enclosing.depth) !== 0) return false;

  if (isStructurallyEmptyItem(enclosing.node)) {
    const parentList = $from.node(enclosing.depth - 1);
    if (parentList.childCount === 1) {
      // Sole empty item: lift it out (list unwraps, cursor stays in the
      // resulting paragraph). Deleting it instead would trigger ProseMirror's
      // schema refill — see the header note.
      return liftAndConsumeBackspace(view, listItemType, event);
    }

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

  // Non-empty list item at content start: lift one level (top-level items
  // become paragraphs; nested items outdent into the parent list).
  return liftAndConsumeBackspace(view, listItemType, event);
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
