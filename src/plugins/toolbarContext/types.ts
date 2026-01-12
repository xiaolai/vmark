/**
 * Shared Toolbar Context Types
 *
 * Common types for toolbar intent resolution across WYSIWYG (Tiptap) and Source (CodeMirror).
 * These types enable a unified priority-based routing system.
 */

/**
 * Toolbar intent - what toolbar mode should be shown.
 * This is the output of the intent resolver.
 */
export type ToolbarIntent =
  | { type: "code"; info: CodeBlockInfo }
  | { type: "blockMath"; info: BlockMathInfo }
  | { type: "table"; info: TableInfo }
  | { type: "list"; info: ListInfo }
  | { type: "blockquote"; info: BlockquoteInfo }
  | { type: "format"; selection: SelectionInfo; autoSelected?: boolean }
  | { type: "link"; info: LinkInfo }
  | { type: "image"; info: ImageInfo }
  | { type: "inlineMath"; info: InlineMathInfo }
  | { type: "footnote"; info: FootnoteInfo }
  | { type: "heading"; info: HeadingInfo }
  | { type: "insert"; contextMode: "insert" | "insert-block" }
  | { type: "none" }; // No toolbar should be shown (e.g., image has own popup in WYSIWYG)

/**
 * Cursor context - input to the intent resolver.
 * Adapters for each surface (Tiptap/CodeMirror) produce this.
 */
export interface CursorContext {
  // Block-level contexts (highest priority)
  inCodeBlock?: CodeBlockInfo;
  inBlockMath?: BlockMathInfo; // Source mode only
  inTable?: TableInfo;
  inList?: ListInfo;
  inBlockquote?: BlockquoteInfo;

  // Selection state
  hasSelection: boolean;
  selectionInfo?: SelectionInfo;

  // Inline contexts
  inFormattedRange?: FormattedRangeInfo;
  inLink?: LinkInfo;
  inImage?: ImageInfo;
  inInlineMath?: InlineMathInfo;
  inFootnote?: FootnoteInfo;

  // Line-level contexts
  inHeading?: HeadingInfo;
  atLineStart: boolean;

  // Word-level context
  inWord?: WordInfo;

  // Fallback context mode
  contextMode: "insert" | "insert-block";

  // Surface-specific flags
  surface: "wysiwyg" | "source";
}

// Info types for each context

export interface CodeBlockInfo {
  language?: string;
  from: number;
  to: number;
}

export interface BlockMathInfo {
  from: number;
  to: number;
}

export interface TableInfo {
  row: number;
  col: number;
  totalRows: number;
  totalCols: number;
}

export interface ListInfo {
  listType: "bullet" | "ordered" | "task";
  depth: number;
  checked?: boolean;
}

export interface BlockquoteInfo {
  depth: number;
}

export interface SelectionInfo {
  from: number;
  to: number;
  text: string;
}

export interface FormattedRangeInfo {
  markType: string;
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
}

export interface LinkInfo {
  href: string;
  text: string;
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
}

export interface ImageInfo {
  src: string;
  alt?: string;
  from: number;
  to: number;
}

export interface InlineMathInfo {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
}

export interface FootnoteInfo {
  label: string;
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
}

export interface HeadingInfo {
  level: number; // 0 = paragraph, 1-6 = heading levels
  nodePos?: number; // For WYSIWYG
  lineStart?: number; // For Source
  lineEnd?: number;
}

export interface WordInfo {
  from: number;
  to: number;
  text: string;
}
