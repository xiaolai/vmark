/**
 * Format Toolbar Types
 *
 * Purpose: Type definitions for the selection-aware format toolbar context system
 * that adapts toolbar items based on cursor position and selection state.
 *
 * @coordinates-with tiptapContext.ts — builds these contexts from editor state
 * @coordinates-with nodeDetection.tiptap.ts — detects node types for context building
 * @module plugins/formatToolbar/types
 */

export type ContextMode = "format" | "inline-insert" | "block-insert";

export interface HeadingInfo {
  level: number; // 1-6, or 0 for paragraph
  nodePos: number;
}

export interface CodeBlockInfo {
  language: string;
  nodePos: number;
}

export interface TableNodeContext {
  type: "table";
  tablePos: number;
  rowIndex: number;
  colIndex: number;
  numRows: number;
  numCols: number;
}

export interface ListNodeContext {
  type: "list";
  listType: "bullet" | "ordered" | "task";
  nodePos: number;
  depth: number;
}

export interface BlockquoteNodeContext {
  type: "blockquote";
  nodePos: number;
  depth: number;
}

export type NodeContext =
  | TableNodeContext
  | ListNodeContext
  | BlockquoteNodeContext
  | null;
