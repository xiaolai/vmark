/**
 * Document-related types for the bridge layer.
 * Covers Selection, Heading, Metadata, Format/Block/List types,
 * search/replace results, edit results, and suggestions.
 */

import type { Range } from './protocol-types.js';

/**
 * Window identifier for multi-window support.
 * Can be 'focused' for the currently focused window, or a specific window label.
 */
export type WindowId = 'focused' | string;

/**
 * Position in the document.
 */
export interface Position {
  /** Character offset from start of document */
  offset: number;
}

/**
 * Text selection state.
 */
export interface Selection {
  /** Selected text content */
  text: string;
  /** Selection range */
  range: Range;
  /** Whether selection is empty (cursor only) */
  isEmpty: boolean;
}

/**
 * Cursor context — surrounding content for AI context.
 */
export interface CursorContext {
  /** Text before cursor (configurable lines) */
  before: string;
  /** Text after cursor (configurable lines) */
  after: string;
  /** Current line content */
  currentLine: string;
  /** Current paragraph content */
  currentParagraph: string;
}

/**
 * Document heading for outline.
 */
export interface Heading {
  /** Heading level (1-6) */
  level: number;
  /** Heading text */
  text: string;
  /** Position in document */
  position: number;
}

/**
 * Document metadata.
 */
export interface DocumentMetadata {
  /** File path (null for unsaved) */
  filePath: string | null;
  /** Document title (from first heading or filename) */
  title: string;
  /** Word count */
  wordCount: number;
  /** Character count */
  characterCount: number;
  /** Whether document has unsaved changes */
  isModified: boolean;
  /** Last modified timestamp */
  lastModified: Date | null;
}

/**
 * Format types for toggle operations (inline marks).
 */
export type FormatType = 'bold' | 'italic' | 'code' | 'strike' | 'underline' | 'highlight';

/**
 * Block types for block operations.
 */
export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'codeBlock'
  | 'blockquote';

/**
 * List types.
 */
export type ListType = 'bullet' | 'ordered' | 'task' | 'taskList';

/**
 * CJK punctuation conversion direction.
 */
export type CjkDirection = 'to-fullwidth' | 'to-halfwidth';

/**
 * CJK spacing action.
 */
export type CjkSpacingAction = 'add' | 'remove';

/**
 * Search match result.
 */
export interface SearchMatch {
  /** Match text */
  text: string;
  /** Match position */
  range: Range;
  /** Line number (1-indexed) */
  lineNumber: number;
}

/**
 * Search result.
 */
export interface SearchResult {
  /** Total matches found */
  count: number;
  /** Match details */
  matches: SearchMatch[];
}

/**
 * Replace result.
 */
export interface ReplaceResult {
  /** Number of replacements made */
  count: number;
  /** Message describing the result */
  message?: string;
  /** Suggestion IDs if edits were staged (auto-approve disabled) */
  suggestionIds?: string[];
}

/**
 * Edit operation result (insert, replace at cursor, etc.).
 * When auto-approve is disabled, includes suggestionId for the staged edit.
 */
export interface EditResult {
  /** Human-readable message */
  message: string;
  /** Suggestion ID if edit was staged (auto-approve disabled) */
  suggestionId?: string;
  /** Position where content was inserted */
  position?: number;
  /** Range that was affected */
  range?: Range;
  /** Original content that was replaced/deleted */
  originalContent?: string;
  /** Content that was deleted */
  content?: string;
}

/**
 * Suggestion type for AI-generated edits.
 */
export type SuggestionType = 'insert' | 'replace' | 'delete';

/**
 * AI suggestion for user approval.
 */
export interface Suggestion {
  /** Unique suggestion ID */
  id: string;
  /** Type of edit */
  type: SuggestionType;
  /** Start position in document */
  from: number;
  /** End position in document */
  to: number;
  /** New content to insert/replace (undefined for delete) */
  newContent?: string;
  /** Original content being replaced/deleted */
  originalContent?: string;
  /** When the suggestion was created */
  createdAt: number;
}

/**
 * Suggestion list response.
 */
export interface SuggestionListResult {
  /** All pending suggestions */
  suggestions: Suggestion[];
  /** Total count */
  count: number;
  /** Currently focused suggestion ID */
  focusedId: string | null;
}

/**
 * Recent file entry.
 */
export interface RecentFile {
  /** Absolute file path */
  path: string;
  /** File name (basename) */
  name: string;
  /** Timestamp when file was last opened */
  timestamp: number;
}
