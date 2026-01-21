/**
 * Cursor Context Types
 *
 * Shared interface for cursor position context across both editor modes.
 * Source mode (CodeMirror) and WYSIWYG mode (Tiptap/ProseMirror) implement
 * this interface with their own detection logic.
 */

import type { FormatType } from "@/plugins/sourceContextDetection/formatTypes";

/**
 * Code block context (code fence in source, code block node in WYSIWYG)
 */
export interface CodeBlockContext {
  language: string;
  nodePos: number;  // Start position of the code block
}

/**
 * Table context
 */
export interface TableContext {
  row: number;      // Current row index (0-based)
  col: number;      // Current column index (0-based)
  isHeader: boolean; // Whether cursor is in header row
  nodePos: number;  // Start position of the table
}

/**
 * List context
 */
export interface ListContext {
  type: "bullet" | "ordered" | "task";
  depth: number;    // Nesting level (1 = top level)
  nodePos: number;  // Start position of the list item
}

/**
 * Blockquote context
 */
export interface BlockquoteContext {
  depth: number;    // Nesting level (1 = top level)
  nodePos: number;  // Start position of the blockquote
}

/**
 * Heading context
 */
export interface HeadingContext {
  level: number;    // 1-6 for headings, 0 for paragraph
  nodePos: number;  // Start position of the heading
}

/**
 * Link context
 */
export interface LinkContext {
  href: string;
  text: string;
  from: number;     // Start of entire link syntax
  to: number;       // End of entire link syntax
  contentFrom: number; // Start of link text
  contentTo: number;   // End of link text
}

/**
 * Image context
 */
export interface ImageContext {
  src: string;
  alt: string;
  from: number;
  to: number;
}

/**
 * Inline math context
 */
export interface InlineMathContext {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
}

/**
 * Footnote context
 */
export interface FootnoteContext {
  label: string;
  from: number;
  to: number;
  contentFrom: number;  // Start of label (after [^)
  contentTo: number;    // End of label (before ])
}

/**
 * Formatted range context (bold, italic, etc.)
 */
export interface FormattedRangeContext {
  type: FormatType;
  from: number;        // Start of opening marker
  to: number;          // End of closing marker
  contentFrom: number; // Start of content
  contentTo: number;   // End of content
}

/**
 * Word range at cursor
 */
export interface WordRange {
  from: number;
  to: number;
}

/**
 * Context mode determines which toolbar buttons to show
 */
export type ContextMode = "format" | "inline-insert" | "block-insert";

/**
 * Unified cursor context interface
 *
 * All fields are null when cursor is not in that context.
 * Computed once per cursor move, cached for all consumers.
 */
export interface CursorContext {
  // Block context (can be nested)
  inCodeBlock: CodeBlockContext | null;
  inBlockMath: { nodePos: number } | null;
  inTable: TableContext | null;
  inList: ListContext | null;
  inBlockquote: BlockquoteContext | null;
  inHeading: HeadingContext | null;

  // Inline context (mutually exclusive)
  inLink: LinkContext | null;
  inImage: ImageContext | null;
  inInlineMath: InlineMathContext | null;
  inFootnote: FootnoteContext | null;

  // Format marks (all active, innermost first)
  activeFormats: FormatType[];
  formatRanges: FormattedRangeContext[];
  innermostFormat: FormattedRangeContext | null;

  // Position
  atLineStart: boolean;
  atBlankLine: boolean;
  inWord: WordRange | null;
  contextMode: ContextMode;

  // Boundary detection
  nearSpace: boolean;        // Cursor adjacent to whitespace
  nearPunctuation: boolean;  // Cursor adjacent to punctuation (including CJK)

  // Selection state
  hasSelection: boolean;
  selectionFrom: number;
  selectionTo: number;
}

/**
 * Create an empty cursor context (initial state)
 */
export function createEmptyCursorContext(): CursorContext {
  return {
    inCodeBlock: null,
    inBlockMath: null,
    inTable: null,
    inList: null,
    inBlockquote: null,
    inHeading: null,
    inLink: null,
    inImage: null,
    inInlineMath: null,
    inFootnote: null,
    activeFormats: [],
    formatRanges: [],
    innermostFormat: null,
    atLineStart: false,
    atBlankLine: false,
    inWord: null,
    contextMode: "inline-insert",
    nearSpace: false,
    nearPunctuation: false,
    hasSelection: false,
    selectionFrom: 0,
    selectionTo: 0,
  };
}
