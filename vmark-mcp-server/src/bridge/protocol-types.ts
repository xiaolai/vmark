/**
 * Protocol types for the AI-oriented MCP design layer.
 * Covers AST nodes, structured errors, capabilities, mutations,
 * sections, paragraphs, tables, lists, smart insert, and diff operations.
 */

// =============================================================================
// Error and Capability Types
// =============================================================================

/**
 * Error codes for structured error responses.
 */
export type ErrorCode =
  | 'not_found'        // Target node/section doesn't exist
  | 'ambiguous_target' // Multiple matches for query
  | 'conflict'         // Document changed (revision mismatch)
  | 'invalid_selector' // Query syntax error
  | 'too_large'        // Payload exceeds limit
  | 'rate_limited'     // Too many requests
  | 'invalid_operation'; // Malformed operation

/**
 * Recovery action hints for error responses.
 */
export interface RecoveryHint {
  action: 'retry' | 'refresh' | 'disambiguate';
  hints: string[];
}

/**
 * Structured error response.
 */
export interface StructuredError {
  success: false;
  error: ErrorCode;
  details: {
    message: string;
    [key: string]: unknown;
  };
  recovery?: RecoveryHint;
}

/**
 * Server capabilities response.
 */
export interface Capabilities {
  version: string;
  supportedNodeTypes: string[];
  supportedQueryOperators: string[];
  limits: {
    maxBatchSize: number;
    maxPayloadBytes: number;
    maxRequestsPerSecond: number;
    maxConcurrentRequests: number;
  };
  features: {
    suggestionModeSupported: boolean;
    revisionTracking: boolean;
    idempotency: boolean;
  };
}

/**
 * Revision info response.
 */
export interface RevisionInfo {
  revision: string;
  lastUpdated: number;
}

// =============================================================================
// AST and Structure Types
// =============================================================================

/**
 * Range in the document.
 */
export interface Range {
  /** Start position (inclusive) */
  from: number;
  /** End position (exclusive) */
  to: number;
}

/**
 * AST node representation for AI consumption.
 */
export interface AstNode {
  id: string;
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  children?: AstNode[];
}

/**
 * Projection fields for AST queries.
 */
export type AstProjection = 'id' | 'type' | 'text' | 'attrs' | 'marks' | 'children';

/**
 * Node type for filtering.
 */
export type NodeType =
  | 'paragraph'
  | 'heading'
  | 'codeBlock'
  | 'blockquote'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'listItem'
  | 'taskItem'
  | 'table'
  | 'tableRow'
  | 'tableHeader'
  | 'tableCell'
  | 'horizontalRule'
  | 'image'
  | 'hardBreak'
  | 'text';

/**
 * Block query for filtering nodes.
 */
export interface BlockQuery {
  type?: NodeType | NodeType[];
  level?: number;
  contains?: string;
  hasMarks?: string[];
}

/**
 * Block info for list_blocks response.
 */
export interface BlockInfo {
  id: string;
  type: string;
  text: string;
  preview: string;
  pos: Range;
  context?: { before: string; after: string };
}

/**
 * Outline entry for document digest.
 */
export interface OutlineEntry {
  id: string;
  level: number;
  text: string;
  children?: OutlineEntry[];
}

/**
 * Section summary for document digest.
 */
export interface SectionSummary {
  headingId: string;
  headingText: string;
  level: number;
  wordCount: number;
  blockCount: number;
}

/**
 * Document digest response.
 */
export interface DocumentDigest {
  revision: string;
  title: string;
  wordCount: number;
  charCount: number;
  outline: OutlineEntry[];
  sections: SectionSummary[];
  blockCounts: Record<string, number>;
  hasImages: boolean;
  hasTables: boolean;
  hasCodeBlocks: boolean;
  languages: string[];
}

/**
 * AST response with pagination.
 */
export interface AstResponse {
  revision: string;
  nodes: AstNode[];
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * Target resolution candidate.
 */
export interface TargetCandidate {
  nodeId: string;
  score: number;
  reason: string;
  preview: string;
  pos: Range;
}

/**
 * Target resolution response.
 */
export interface TargetResolution {
  candidates: TargetCandidate[];
  isAmbiguous: boolean;
  revision: string;
}

/**
 * Section info response.
 */
export interface SectionInfo {
  revision: string;
  sectionId: string;
  heading: { id: string; text: string; level: number };
  content: AstNode[];
  range: Range;
  subsections?: SectionInfo[];
}

// =============================================================================
// Mutation Types
// =============================================================================

/**
 * Operation mode for mutations.
 */
export type OperationMode = 'apply' | 'suggest' | 'dryRun';

/**
 * Mark specification for format operations.
 */
export interface MarkSpec {
  type: string;
  attrs?: Record<string, unknown>;
}

/**
 * Batch operation types.
 */
export type BatchOperation =
  | { type: 'update'; nodeId: string; text?: string; attrs?: Record<string, unknown> }
  | { type: 'insert'; after: string; content: string | AstNode }
  | { type: 'delete'; nodeId: string }
  | { type: 'format'; nodeId: string; marks: MarkSpec[] }
  | { type: 'move'; nodeId: string; after: string };

/**
 * Batch edit result.
 */
export interface BatchEditResult {
  success: boolean;
  newRevision?: string;
  changedNodeIds: string[];
  addedNodeIds: string[];
  deletedNodeIds: string[];
  idRemap: Record<string, string>;
  warnings: string[];
  suggestionIds?: string[];
  undoToken?: string;
}

/**
 * Match policy for diff operations.
 */
export type MatchPolicy = 'first' | 'all' | 'nth' | 'error_if_multiple';

/**
 * Match info for diff operations.
 */
export interface MatchInfo {
  nodeId: string;
  position: number;
  context: { before: string; after: string };
}

/**
 * Apply diff result.
 */
export interface ApplyDiffResult {
  success: boolean;
  matchCount: number;
  appliedCount: number;
  matches?: MatchInfo[];
  newRevision?: string;
  suggestionIds?: string[];
}

/**
 * Anchor specification for drift-tolerant replacement.
 */
export interface TextAnchor {
  text: string;
  beforeContext: string;
  afterContext: string;
  maxDistance: number;
}

// =============================================================================
// Section Types
// =============================================================================

/**
 * Section target specification.
 */
export interface SectionTarget {
  /** Match by heading text (case-insensitive) */
  heading?: string;
  /** Match by level and index */
  byIndex?: { level: number; index: number };
  /** Match by section ID */
  sectionId?: string;
}

/**
 * New section heading specification.
 */
export interface NewHeading {
  level: number;
  text: string;
}

// =============================================================================
// Paragraph Types
// =============================================================================

/**
 * Paragraph target specification.
 * Used to identify a specific paragraph in a document.
 */
export interface ParagraphTarget {
  /** Match by paragraph index (0-indexed) */
  index?: number;
  /** Match by text the paragraph contains */
  containing?: string;
}

/**
 * Paragraph info response from read_paragraph.
 */
export interface ParagraphInfo {
  /** Paragraph index in document (0-indexed) */
  index: number;
  /** Paragraph content as markdown */
  content: string;
  /** Word count */
  wordCount: number;
  /** Character count */
  charCount: number;
  /** Position range in document */
  position: Range;
  /** Context if requested */
  context?: {
    before?: string;
    after?: string;
  };
}

/**
 * Paragraph operation type for write_paragraph.
 */
export type ParagraphOperation = 'replace' | 'append' | 'prepend' | 'delete';

/**
 * Write paragraph result.
 */
export interface WriteParagraphResult {
  success: boolean;
  message: string;
  suggestionId?: string;
  applied: boolean;
  newRevision?: string;
}

// =============================================================================
// Smart Insert Types
// =============================================================================

/**
 * Smart insert destination specification.
 * Provides intuitive insertion points for common scenarios.
 */
export type SmartInsertDestination =
  | 'end_of_document'
  | 'start_of_document'
  | { after_paragraph: number }
  | { after_paragraph_containing: string }
  | { after_section: string };

/**
 * Smart insert result.
 */
export interface SmartInsertResult {
  success: boolean;
  message: string;
  suggestionId?: string;
  applied: boolean;
  newRevision?: string;
  /** Position where content was inserted (ProseMirror offset) */
  insertPosition?: number;
}

// =============================================================================
// Table Batch Operation Types
// =============================================================================

/**
 * Table target specification.
 */
export interface TableTarget {
  /** Match by table ID */
  tableId?: string;
  /** Match by heading the table appears under */
  afterHeading?: string;
  /** Match by table index in document (0-based) */
  tableIndex?: number;
}

/**
 * Table operation types.
 */
export type TableOperation =
  | { action: 'add_row'; at: number; cells: string[] }
  | { action: 'delete_row'; at: number }
  | { action: 'add_column'; at: number; header: string; cells: string[] }
  | { action: 'delete_column'; at: number }
  | { action: 'update_cell'; row: number; col: number; content: string }
  | { action: 'set_header'; row: number; isHeader: boolean };

// =============================================================================
// List Batch Operation Types
// =============================================================================

/**
 * List target specification.
 */
export interface ListTarget {
  /** Match by list ID */
  listId?: string;
  /** CSS-like selector */
  selector?: string;
  /** Match by list index in document (0-based) */
  listIndex?: number;
}

/**
 * List operation types.
 */
export type ListOperation =
  | { action: 'add_item'; at: number; text: string; indent?: number }
  | { action: 'delete_item'; at: number }
  | { action: 'update_item'; at: number; text: string }
  | { action: 'toggle_check'; at: number }
  | { action: 'reorder'; order: number[] }
  | { action: 'set_indent'; at: number; indent: number };
