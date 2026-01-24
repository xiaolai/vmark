/**
 * AI Suggestion Types
 *
 * Types for the AI suggestion approval system.
 */

export type SuggestionType = "insert" | "replace" | "delete";

export interface AiSuggestion {
  /** Unique identifier for this suggestion */
  id: string;
  /** Type of modification */
  type: SuggestionType;
  /** Start position in document */
  from: number;
  /** End position in document */
  to: number;
  /** New content for insert/replace operations */
  newContent?: string;
  /** Original content for replace/delete operations (used to restore on reject) */
  originalContent?: string;
  /** Timestamp when suggestion was created */
  createdAt: number;
}
