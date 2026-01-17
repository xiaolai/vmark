/**
 * Bridge types for communication between MCP server and VMark app.
 * This abstraction enables dependency injection for testing.
 */

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
 * Writing style for AI improvements.
 */
export type WritingStyle = 'formal' | 'casual' | 'concise' | 'elaborate' | 'academic';

/**
 * Summary length.
 */
export type SummaryLength = 'brief' | 'medium' | 'detailed';

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
  // Tab commands
  | { type: 'tabs.list'; windowId?: WindowId }
  | { type: 'tabs.getActive'; windowId?: WindowId }
  | { type: 'tabs.switch'; tabId: string; windowId?: WindowId }
  | { type: 'tabs.close'; tabId?: string; windowId?: WindowId }
  | { type: 'tabs.create'; windowId?: WindowId }
  | { type: 'tabs.getInfo'; tabId?: string; windowId?: WindowId }
  // VMark-specific commands
  | { type: 'vmark.insertMathInline'; latex: string; windowId?: WindowId }
  | { type: 'vmark.insertMathBlock'; latex: string; windowId?: WindowId }
  | { type: 'vmark.insertMermaid'; code: string; windowId?: WindowId }
  | { type: 'vmark.insertWikiLink'; target: string; displayText?: string; windowId?: WindowId }
  | { type: 'vmark.cjkPunctuationConvert'; direction: CjkDirection; windowId?: WindowId }
  | { type: 'vmark.cjkSpacingFix'; action: CjkSpacingAction; windowId?: WindowId }
  // AI commands
  | { type: 'ai.improveWriting'; style?: WritingStyle; instructions?: string; windowId?: WindowId }
  | { type: 'ai.fixGrammar'; windowId?: WindowId }
  | { type: 'ai.translate'; targetLanguage: string; windowId?: WindowId }
  | { type: 'ai.summarize'; length?: SummaryLength; windowId?: WindowId }
  | { type: 'ai.expand'; focus?: string; windowId?: WindowId };

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
}
