/**
 * Bridge types for communication between MCP server and VMark app.
 * This abstraction enables dependency injection for testing.
 */

/**
 * Window identifier for multi-window support.
 * Can be 'focused' for the currently focused window, or a specific window label.
 */
export type WindowId = 'focused' | string;

// =============================================================================
// Protocol Types (AI-Oriented MCP Design)
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

/**
 * Position in the document.
 */
export interface Position {
  /** Character offset from start of document */
  offset: number;
}

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
 * Cursor context - surrounding content for AI context.
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
 * Window info for list_windows resource.
 */
export interface WindowInfo {
  /** Window label (unique identifier) */
  label: string;
  /** Window title */
  title: string;
  /** File path (null for unsaved) */
  filePath: string | null;
  /** Whether this is the focused window */
  isFocused: boolean;
  /** Whether document is exposed to AI */
  isAiExposed: boolean;
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
 * Bridge request types - commands that can be sent to VMark.
 */
export type BridgeRequest =
  // Document commands
  | { type: 'document.getContent'; windowId?: WindowId }
  | { type: 'document.setContent'; content: string; windowId?: WindowId }
  | { type: 'document.insertAtCursor'; text: string; windowId?: WindowId }
  | { type: 'document.insertAtPosition'; text: string; position: number; windowId?: WindowId }
  | { type: 'document.search'; query: string; caseSensitive?: boolean; windowId?: WindowId }
  | { type: 'document.replace'; search: string; replace: string; all?: boolean; windowId?: WindowId }
  // Selection commands
  | { type: 'selection.get'; windowId?: WindowId }
  | { type: 'selection.set'; from: number; to: number; windowId?: WindowId }
  | { type: 'selection.replace'; text: string; windowId?: WindowId }
  | { type: 'selection.delete'; windowId?: WindowId }
  // Cursor commands
  | { type: 'cursor.getContext'; linesBefore?: number; linesAfter?: number; windowId?: WindowId }
  | { type: 'cursor.setPosition'; position: number; windowId?: WindowId }
  // Format commands
  | { type: 'format.toggle'; format?: FormatType; mark?: FormatType; windowId?: WindowId }
  | { type: 'format.setLink'; url?: string; href?: string; text?: string; title?: string; windowId?: WindowId }
  | { type: 'format.removeLink'; windowId?: WindowId }
  | { type: 'format.clear'; windowId?: WindowId }
  // Block commands
  | { type: 'block.setType'; blockType: BlockType; level?: number; language?: string; windowId?: WindowId }
  | { type: 'block.toggle'; blockType: BlockType; level?: number; windowId?: WindowId }
  | { type: 'block.insertHorizontalRule'; windowId?: WindowId }
  // List commands
  | { type: 'list.toggle'; listType: ListType; windowId?: WindowId }
  | { type: 'list.increaseIndent'; windowId?: WindowId }
  | { type: 'list.decreaseIndent'; windowId?: WindowId }
  // Table commands
  | { type: 'table.insert'; rows: number; cols: number; withHeaderRow?: boolean; windowId?: WindowId }
  | { type: 'table.delete'; windowId?: WindowId }
  | { type: 'table.addRowBefore'; windowId?: WindowId }
  | { type: 'table.addRowAfter'; windowId?: WindowId }
  | { type: 'table.deleteRow'; windowId?: WindowId }
  | { type: 'table.addColumnBefore'; windowId?: WindowId }
  | { type: 'table.addColumnAfter'; windowId?: WindowId }
  | { type: 'table.deleteColumn'; windowId?: WindowId }
  | { type: 'table.toggleHeaderRow'; windowId?: WindowId }
  // Editor commands
  | { type: 'editor.undo'; windowId?: WindowId }
  | { type: 'editor.redo'; windowId?: WindowId }
  | { type: 'editor.focus'; windowId?: WindowId }
  // Metadata commands
  | { type: 'metadata.get'; windowId?: WindowId }
  | { type: 'outline.get'; windowId?: WindowId }
  // Window commands
  | { type: 'windows.list' }
  | { type: 'windows.getFocused' }
  | { type: 'windows.focus'; windowId: WindowId }
  // Workspace commands
  | { type: 'workspace.newDocument'; title?: string }
  | { type: 'workspace.openDocument'; path: string }
  | { type: 'workspace.saveDocument'; windowId?: WindowId }
  | { type: 'workspace.saveDocumentAs'; path: string; windowId?: WindowId }
  | { type: 'workspace.getDocumentInfo'; windowId?: WindowId }
  | { type: 'workspace.closeWindow'; windowId?: WindowId }
  | { type: 'workspace.listRecentFiles' }
  | { type: 'workspace.getInfo'; windowId?: WindowId }
  // Tab commands
  | { type: 'tabs.list'; windowId?: WindowId }
  | { type: 'tabs.getActive'; windowId?: WindowId }
  | { type: 'tabs.switch'; tabId: string; windowId?: WindowId }
  | { type: 'tabs.close'; tabId?: string; windowId?: WindowId }
  | { type: 'tabs.create'; windowId?: WindowId }
  | { type: 'tabs.getInfo'; tabId?: string; windowId?: WindowId }
  | { type: 'tabs.reopenClosed'; windowId?: WindowId }
  // VMark-specific commands
  | { type: 'vmark.insertMathInline'; latex: string; windowId?: WindowId }
  | { type: 'vmark.insertMathBlock'; latex: string; windowId?: WindowId }
  | { type: 'vmark.insertMermaid'; code: string; windowId?: WindowId }
  | { type: 'vmark.insertWikiLink'; target: string; displayText?: string; windowId?: WindowId }
  | { type: 'vmark.cjkPunctuationConvert'; direction: CjkDirection; windowId?: WindowId }
  | { type: 'vmark.cjkSpacingFix'; action: CjkSpacingAction; windowId?: WindowId }
  // Suggestion commands
  | { type: 'suggestion.list'; windowId?: WindowId }
  | { type: 'suggestion.accept'; suggestionId: string; windowId?: WindowId }
  | { type: 'suggestion.reject'; suggestionId: string; windowId?: WindowId }
  | { type: 'suggestion.acceptAll'; windowId?: WindowId }
  | { type: 'suggestion.rejectAll'; windowId?: WindowId }
  // Protocol commands (AI-Oriented MCP Design)
  | { type: 'protocol.getCapabilities' }
  | { type: 'protocol.getRevision'; windowId?: WindowId }
  // Structure commands
  | { type: 'structure.getAst'; projection?: AstProjection[]; filter?: BlockQuery; limit?: number; offset?: number; afterCursor?: string; windowId?: WindowId }
  | { type: 'structure.getDigest'; windowId?: WindowId }
  | { type: 'structure.listBlocks'; query?: BlockQuery; limit?: number; afterCursor?: string; projection?: string[]; windowId?: WindowId }
  | { type: 'structure.resolveTargets'; query: BlockQuery; maxResults?: number; windowId?: WindowId }
  | { type: 'structure.getSection'; heading: string | { level: number; index: number }; includeNested?: boolean; windowId?: WindowId }
  // Mutation commands
  | { type: 'mutation.batchEdit'; baseRevision: string; requestId?: string; mode: OperationMode; operations: BatchOperation[]; windowId?: WindowId }
  | { type: 'mutation.applyDiff'; baseRevision: string; scopeQuery?: BlockQuery; original: string; replacement: string; matchPolicy: MatchPolicy; nth?: number; mode?: OperationMode; windowId?: WindowId }
  | { type: 'mutation.replaceAnchored'; baseRevision: string; anchor: TextAnchor; replacement: string; mode?: OperationMode; windowId?: WindowId }
  // Section commands
  | { type: 'section.update'; baseRevision: string; target: SectionTarget; newContent: string; mode?: OperationMode; windowId?: WindowId }
  | { type: 'section.insert'; baseRevision: string; after?: SectionTarget; heading: NewHeading; content: string; mode?: OperationMode; windowId?: WindowId }
  | { type: 'section.move'; baseRevision: string; section: SectionTarget; after?: SectionTarget; mode?: OperationMode; windowId?: WindowId }
  // Table batch commands
  | { type: 'table.batchModify'; baseRevision: string; target: TableTarget; operations: TableOperation[]; mode?: OperationMode; windowId?: WindowId }
  // List batch commands
  | { type: 'list.batchModify'; baseRevision: string; target: ListTarget; operations: ListOperation[]; mode?: OperationMode; windowId?: WindowId };

/**
 * Bridge response types - responses from VMark.
 */
export type BridgeResponse =
  | { success: true; data: unknown }
  | { success: false; error: string; code?: string };

/**
 * Bridge interface - abstracts communication with VMark.
 * Implement this interface for WebSocket connection or mocks.
 */
export interface Bridge {
  /**
   * Send a request to VMark and wait for response.
   * @param request The request to send
   * @returns Promise resolving to the response
   * @throws Error if connection fails or timeout
   */
  send<T = unknown>(request: BridgeRequest): Promise<BridgeResponse & { data: T }>;

  /**
   * Check if bridge is connected to VMark.
   */
  isConnected(): boolean;

  /**
   * Connect to VMark.
   * @throws Error if connection fails
   */
  connect(): Promise<void>;

  /**
   * Disconnect from VMark.
   */
  disconnect(): Promise<void>;

  /**
   * Subscribe to connection state changes.
   */
  onConnectionChange(callback: (connected: boolean) => void): () => void;
}

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

/**
 * Workspace info response.
 */
export interface WorkspaceInfo {
  /** Whether currently in workspace mode */
  isWorkspaceMode: boolean;
  /** Workspace root path (null if not in workspace mode) */
  rootPath: string | null;
  /** Workspace name (folder name, null if not in workspace mode) */
  workspaceName: string | null;
}

/**
 * Reopened tab result.
 */
export interface ReopenedTabResult {
  /** ID of the reopened tab */
  tabId: string;
  /** File path of the reopened tab (null if untitled) */
  filePath: string | null;
  /** Title of the reopened tab */
  title: string;
}
