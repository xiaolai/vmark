/**
 * Shared List Helpers
 *
 * Common utilities for ProseMirror list item operations,
 * used by listClickFix, listBackspace, listContinuation, the format toolbar,
 * and the task toggle.
 *
 * @module plugins/shared/listHelpers
 */

import type { Node as ProseMirrorNode, NodeType, ResolvedPos, Schema } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { liftListItem } from "@tiptap/pm/schema-list";

/**
 * Find the listItem node type in the schema.
 * Handles both "listItem" (Tiptap) and "list_item" (vanilla PM) naming.
 */
export function findListItemType(schema: Schema): NodeType | undefined {
  return schema.nodes["listItem"] ?? schema.nodes["list_item"];
}

/**
 * Check whether a resolved position is inside a listItem node
 * by walking up the document tree from the given position.
 */
export function isPositionInsideListItem(
  $pos: ResolvedPos,
  listItemType: NodeType
): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type === listItemType) {
      return true;
    }
  }
  return false;
}

/**
 * Walk up from a resolved position to the nearest enclosing listItem and
 * return both the node and its depth. Returns null when not inside a list.
 * Handlers that need to delete or re-wrap the list item use the depth to
 * compute cut boundaries via `$pos.before(depth)` / `$pos.after(depth)`.
 */
export function findEnclosingListItem(
  $pos: ResolvedPos,
  listItemType: NodeType
): { node: ProseMirrorNode; depth: number } | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type === listItemType) {
      return { node, depth: d };
    }
  }
  return null;
}

/** True when the selection head sits inside a bullet or ordered list. */
function selectionInList(view: EditorView): boolean {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "bulletList" || name === "orderedList") return true;
  }
  return false;
}

/**
 * Lift the selection out of ALL enclosing bullet/ordered lists by repeatedly
 * applying liftListItem. Stops when the selection leaves every list or the
 * command no longer applies (repeating a failed lift only spins). The
 * optional `beforeEachLift` hook runs before every lift — the task toggle
 * uses it to clear `checked` attrs so lifted items don't carry stale task
 * state. Returns whether anything was lifted.
 */
export function liftSelectionOutOfLists(
  view: EditorView,
  beforeEachLift?: (view: EditorView) => void
): boolean {
  const listItemType = findListItemType(view.state.schema);
  if (!listItemType) return false;

  let lifted = false;
  const maxLifts = 10; // safety bound for pathological nesting
  for (let i = 0; i < maxLifts; i++) {
    if (!selectionInList(view)) break;
    // Probe applicability FIRST (command without dispatch): running the
    // mutation hook and then failing the lift would leave a half-applied
    // state (e.g. checked attrs cleared but the item never lifted).
    if (!liftListItem(listItemType)(view.state)) break;
    beforeEachLift?.(view);
    if (!liftListItem(listItemType)(view.state, view.dispatch)) break;
    lifted = true;
  }
  return lifted;
}

/**
 * Whether a selection sits entirely inside ONE list item.
 *
 * The range-based list commands (`convertRangeToListType`, `unlistCoveredLists`)
 * exist to handle a selection that genuinely covers several items or several
 * lists. Handed a selection of one WORD inside a nested item they over-reach:
 * converting a nested item turned the whole outer structure into an ordered
 * list, and removing one produced a list, an unlisted line, and a list with a
 * different bullet character. The caret path already handles that position
 * correctly, so the range path should decline it.
 */
export function selectionWithinOneListItem(state: EditorState): boolean {
  const { $from, $to, empty } = state.selection;
  if (empty) return true;
  const start = enclosingListItemStart($from);
  return start !== null && start === enclosingListItemStart($to);
}

/** Document position of the innermost listItem containing `$pos`, or null. */
function enclosingListItemStart($pos: ResolvedPos): number | null {
  for (let d = $pos.depth; d > 0; d -= 1) {
    if ($pos.node(d).type.name === "listItem") return $pos.before(d);
  }
  return null;
}
