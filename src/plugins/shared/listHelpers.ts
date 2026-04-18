/**
 * Shared List Helpers
 *
 * Common utilities for ProseMirror list item operations,
 * used by listClickFix, listBackspace, and listContinuation plugins.
 *
 * @module plugins/shared/listHelpers
 */

import type { Node as ProseMirrorNode, NodeType, ResolvedPos, Schema } from "@tiptap/pm/model";

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
