/**
 * Format Toolbar Types
 *
 * Purpose: Type definitions for the selection-aware format toolbar context system
 * that adapts toolbar items based on cursor position and selection state.
 *
 * @coordinates-with tiptapContext.ts — builds these contexts from editor state
 * @module plugins/formatToolbar/types
 */

interface TableNodeContext {
  type: "table";
  tablePos: number;
  rowIndex: number;
  colIndex: number;
  numRows: number;
  numCols: number;
}

interface ListNodeContext {
  type: "list";
  listType: "bullet" | "ordered" | "task";
  nodePos: number;
  depth: number;
}

interface BlockquoteNodeContext {
  type: "blockquote";
  nodePos: number;
  depth: number;
}

export type NodeContext =
  | TableNodeContext
  | ListNodeContext
  | BlockquoteNodeContext
  | null;
