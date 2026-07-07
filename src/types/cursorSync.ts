/**
 * Shared types for cursor synchronization between editors.
 */

/**
 * Node types for cursor sync.
 * Maps to block-level markdown structures.
 */
export type NodeType =
  | "paragraph"
  | "heading"
  | "list_item"
  | "code_block"
  | "table_cell"
  | "blockquote"
  | "alert_block"
  | "details_block"
  | "wiki_link";

/**
 * Block-specific anchor for tables.
 * Provides stable intra-block positioning using row/column coordinates.
 */
interface TableAnchor {
  kind: "table";
  /** Row index (0-based) */
  row: number;
  /** Column index (0-based) */
  col: number;
  /** Character offset within the cell */
  offsetInCell: number;
}

/**
 * Block-specific anchor for code blocks.
 * Provides stable intra-block positioning using line/column within code.
 */
interface CodeBlockAnchor {
  kind: "code";
  /** Line number within the code block (0-based) */
  lineInBlock: number;
  /** Column within that line (0-based) */
  columnInLine: number;
}

/**
 * Block anchor - union of block-specific position info.
 * These coordinates are stable across edits within the block.
 */
export type BlockAnchor = TableAnchor | CodeBlockAnchor;

/**
 * Cursor position info for syncing between editors.
 * Uses sourceLine from remark parser for accurate line mapping.
 */
export interface CursorInfo {
  /**
   * Actual source line number (1-indexed, matches remark parser positions).
   * Used for cursor sync between Source and WYSIWYG modes.
   */
  sourceLine: number;
  /** Word at or near cursor for fine positioning */
  wordAtCursor: string;
  /** Character offset within the word */
  offsetInWord: number;
  /** Type of block the cursor is in */
  nodeType: NodeType;
  /** Cursor position as percentage (0-1) for fallback positioning */
  percentInLine: number;
  /** Characters before cursor for disambiguation */
  contextBefore: string;
  /** Characters after cursor for disambiguation */
  contextAfter: string;
  /**
   * Block-specific anchor for complex blocks (tables, code blocks).
   * Provides stable intra-block coordinates that don't depend on text matching.
   */
  blockAnchor?: BlockAnchor;
}
