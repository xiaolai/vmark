/**
 * Shared types and helpers for batch operation handlers (table + list).
 *
 * @module hooks/mcpBridge/batchOp/shared
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface TableTarget {
  /** Not yet implemented — use afterHeading or tableIndex instead. */
  tableId?: string;
  afterHeading?: string;
  tableIndex?: number;
}

export type TableOperation =
  | { action: "add_row"; at: number; cells: string[] }
  | { action: "delete_row"; at: number }
  | { action: "add_column"; at: number; header: string; cells: string[] }
  | { action: "delete_column"; at: number }
  | { action: "update_cell"; row: number; col: number; content: string }
  | { action: "set_header"; row: number; isHeader: boolean };

export interface ListTarget {
  /** Not yet implemented — use selector or listIndex instead. */
  listId?: string;
  selector?: string;
  listIndex?: number;
}

export type ListOperation =
  | { action: "add_item"; at: number; text: string; indent?: number }
  | { action: "delete_item"; at: number }
  | { action: "update_item"; at: number; text: string }
  | { action: "toggle_check"; at: number }
  | { action: "reorder"; order: number[] }
  | { action: "set_indent"; at: number; indent: number };

/** Extract text from a ProseMirror node. */
export function extractText(node: ProseMirrorNode): string {
  let text = "";
  node.descendants((child) => {
    if (child.isText) {
      text += child.text;
    }
    return true;
  });
  return text;
}

/**
 * Normalize an operation object — accept "action", "type", or "op" as
 * the operation key, and normalize camelCase → snake_case (e.g. "updateCell" → "update_cell").
 * Works for both table and list operations.
 */
export function normalizeOp<T extends { action: string }>(
  raw: T | Record<string, unknown>,
  examples: string
): T {
  const r = raw as Record<string, unknown>;
  const action = (r.action ?? r.type ?? r.op) as string | undefined;
  if (!action) {
    throw new Error(`Operation must have an 'action' field (e.g. ${examples})`);
  }
  const normalized = action.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  return { ...r, action: normalized } as unknown as T;
}
