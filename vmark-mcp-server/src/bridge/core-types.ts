/**
 * Core bridge types for communication between MCP server and VMark app.
 * Contains the Bridge interface, BridgeRequest, and BridgeResponse types.
 */

import type {
  WindowId,
  FormatType,
  BlockType,
  ListType,
  CjkDirection,
  CjkSpacingAction,
} from './document-types.js';
import type {
  AstProjection,
  BlockQuery,
  OperationMode,
  BatchOperation,
  MatchPolicy,
  TextAnchor,
  TableTarget,
  TableOperation,
  ListTarget,
  ListOperation,
  SectionTarget,
  NewHeading,
  ParagraphTarget,
  ParagraphOperation,
  SmartInsertDestination,
} from './protocol-types.js';

/**
 * Bridge request types — commands that can be sent to VMark.
 */
export type BridgeRequest =
  // Document commands
  | { type: 'document.getContent'; windowId?: WindowId }
  | { type: 'document.setContent'; content: string; windowId?: WindowId }
  | { type: 'document.insertAtCursor'; text: string; windowId?: WindowId }
  | { type: 'document.insertAtPosition'; text: string; position: number; windowId?: WindowId }
  | { type: 'document.search'; query: string; caseSensitive?: boolean; windowId?: WindowId }
  | { type: 'document.replaceInSource'; search: string; replace: string; all?: boolean; windowId?: WindowId }
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
  | { type: 'workspace.reloadDocument'; force?: boolean; windowId?: WindowId }
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
  | { type: 'vmark.insertMarkmap'; code: string; windowId?: WindowId }
  | { type: 'vmark.insertSvg'; code: string; windowId?: WindowId }
  | { type: 'vmark.insertWikiLink'; target: string; displayText?: string; windowId?: WindowId }
  | { type: 'vmark.cjkPunctuationConvert'; direction: CjkDirection; windowId?: WindowId }
  | { type: 'vmark.cjkSpacingFix'; action: CjkSpacingAction; windowId?: WindowId }
  | { type: 'vmark.cjkFormat'; scope: 'selection' | 'document'; windowId?: WindowId }
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
  | { type: 'list.batchModify'; baseRevision: string; target: ListTarget; operations: ListOperation[]; mode?: OperationMode; windowId?: WindowId }
  // Paragraph commands
  | { type: 'paragraph.read'; target: ParagraphTarget; includeContext?: boolean; windowId?: WindowId }
  | { type: 'paragraph.write'; baseRevision: string; target: ParagraphTarget; operation: ParagraphOperation; content?: string; mode?: OperationMode; windowId?: WindowId }
  // Smart insert command
  | { type: 'smartInsert'; baseRevision: string; destination: SmartInsertDestination; content: string; mode?: OperationMode; windowId?: WindowId }
  // Media insert command
  | { type: 'insertMedia'; mediaHtml: string; baseRevision: string; windowId?: WindowId }
  // Genie commands
  | { type: 'genies.list'; windowId?: WindowId }
  | { type: 'genies.read'; path: string; windowId?: WindowId }
  | { type: 'genies.invoke'; geniePath: string; scope: string; windowId?: WindowId };

/**
 * Bridge response types — responses from VMark.
 */
export type BridgeResponse =
  | { success: true; data: unknown }
  | { success: false; error: string; code?: string };

/**
 * Bridge interface — abstracts communication with VMark.
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
