#!/usr/bin/env node
/**
 * VMark MCP Server - Main entry point.
 *
 * Exposes VMark's Tiptap editor APIs to AI assistants via MCP protocol.
 *
 * Usage:
 *   npx @vmark/mcp-server
 *   node dist/index.js
 *
 * The server communicates with VMark via WebSocket bridge on localhost:9224.
 */

// Re-export public API
export {
  VMarkMcpServer,
  resolveWindowId,
  validateNonNegativeInteger,
  getStringArg,
  requireStringArg,
  getNumberArg,
  requireNumberArg,
  getBooleanArg,
  getWindowIdArg,
} from './server.js';
export type { VMarkMcpServerConfig, ToolArgs } from './server.js';

// Bridge implementations
export { WebSocketBridge } from './bridge/websocket.js';
export type { WebSocketBridgeConfig, Logger } from './bridge/websocket.js';

// Tool registrations
export { registerDocumentTools } from './tools/document.js';
export { registerSelectionTools } from './tools/selection.js';
export { registerEditorTools } from './tools/editor.js';
export { registerFormattingTools } from './tools/formatting.js';
export { registerBlockTools } from './tools/blocks.js';
export { registerListTools } from './tools/lists.js';
export { registerTableTools } from './tools/tables.js';
export { registerVMarkTools } from './tools/vmark.js';
export { registerWorkspaceTools } from './tools/workspace.js';
export { registerTabTools } from './tools/tabs.js';
export { registerPromptTools } from './tools/prompts.js';

// Resource registrations
export { registerDocumentResources } from './resources/document.js';

export type {
  Bridge,
  BridgeRequest,
  BridgeResponse,
  WindowId,
  Position,
  Range,
  Selection,
  CursorContext,
  Heading,
  DocumentMetadata,
  WindowInfo,
  FormatType,
  BlockType,
  ListType,
  SearchResult,
  SearchMatch,
  ReplaceResult,
} from './bridge/types.js';

export type {
  ToolDefinition,
  ToolHandler,
  ResourceDefinition,
  ResourceHandler,
  ToolCallResult,
  ResourceReadResult,
  McpServerInterface,
} from './types.js';

import { VMarkMcpServer } from './server.js';
import { registerDocumentTools } from './tools/document.js';
import { registerSelectionTools } from './tools/selection.js';
import { registerEditorTools } from './tools/editor.js';
import { registerFormattingTools } from './tools/formatting.js';
import { registerBlockTools } from './tools/blocks.js';
import { registerListTools } from './tools/lists.js';
import { registerTableTools } from './tools/tables.js';
import { registerVMarkTools } from './tools/vmark.js';
import { registerWorkspaceTools } from './tools/workspace.js';
import { registerTabTools } from './tools/tabs.js';
import { registerPromptTools } from './tools/prompts.js';
import { registerDocumentResources } from './resources/document.js';
import type { Bridge } from './bridge/types.js';

/**
 * Create a fully configured VMark MCP server with all tools registered.
 */
export function createVMarkMcpServer(bridge: Bridge): VMarkMcpServer {
  const server = new VMarkMcpServer({ bridge });

  // Register all tool categories
  registerDocumentTools(server);
  registerSelectionTools(server);
  registerEditorTools(server);
  registerFormattingTools(server);
  registerBlockTools(server);
  registerListTools(server);
  registerTableTools(server);
  registerVMarkTools(server);
  registerWorkspaceTools(server);
  registerTabTools(server);
  registerPromptTools(server);

  // Register resources
  registerDocumentResources(server);

  return server;
}

/**
 * List of all tool categories for documentation.
 */
export const TOOL_CATEGORIES = [
  {
    name: 'Document Tools',
    description: 'Read and write document content',
    tools: [
      'document_get_content',
      'document_set_content',
      'document_insert_at_cursor',
      'document_insert_at_position',
      'document_search',
      'document_replace',
    ],
  },
  {
    name: 'Selection Tools',
    description: 'Read and manipulate text selection',
    tools: [
      'selection_get',
      'selection_set',
      'selection_replace',
      'selection_delete',
      'cursor_get_context',
      'cursor_set_position',
    ],
  },
  {
    name: 'Editor Tools',
    description: 'Editor state operations',
    tools: ['editor_undo', 'editor_redo', 'editor_focus'],
  },
  {
    name: 'Formatting Tools',
    description: 'Apply text formatting marks',
    tools: ['format_toggle', 'format_set_link', 'format_remove_link', 'format_clear'],
  },
  {
    name: 'Block Tools',
    description: 'Manage block-level elements',
    tools: ['block_set_type', 'block_toggle', 'block_insert_horizontal_rule'],
  },
  {
    name: 'List Tools',
    description: 'Manage list elements',
    tools: ['list_toggle', 'list_indent', 'list_outdent'],
  },
  {
    name: 'Table Tools',
    description: 'Manage table elements',
    tools: [
      'table_insert',
      'table_delete',
      'table_add_row',
      'table_delete_row',
      'table_add_column',
      'table_delete_column',
      'table_toggle_header_row',
    ],
  },
  {
    name: 'VMark Tools',
    description: 'VMark-specific features (math, diagrams, wiki links, CJK)',
    tools: [
      'insert_math_inline',
      'insert_math_block',
      'insert_mermaid',
      'insert_wiki_link',
      'cjk_punctuation_convert',
      'cjk_spacing_fix',
    ],
  },
  {
    name: 'Workspace Tools',
    description: 'Window and document management',
    tools: [
      'workspace_list_windows',
      'workspace_get_focused',
      'workspace_focus_window',
      'workspace_new_document',
      'workspace_open_document',
      'workspace_save_document',
      'workspace_save_document_as',
      'workspace_get_document_info',
      'workspace_close_window',
    ],
  },
  {
    name: 'Tab Tools',
    description: 'Manage editor tabs within windows',
    tools: [
      'tabs_list',
      'tabs_get_active',
      'tabs_switch',
      'tabs_close',
      'tabs_create',
      'tabs_get_info',
    ],
  },
  {
    name: 'AI Prompt Tools',
    description: 'AI-powered writing assistance',
    tools: [
      'improve_writing',
      'fix_grammar',
      'translate',
      'summarize',
      'expand',
    ],
  },
] as const;

/**
 * List of all resources for documentation.
 */
export const RESOURCES = [
  {
    uri: 'vmark://document/outline',
    name: 'Document Outline',
    description: 'Get the document heading hierarchy',
  },
  {
    uri: 'vmark://document/metadata',
    name: 'Document Metadata',
    description: 'Get document metadata (path, title, word count, etc.)',
  },
  {
    uri: 'vmark://windows/list',
    name: 'Window List',
    description: 'Get list of open AI-exposed windows',
  },
  {
    uri: 'vmark://windows/focused',
    name: 'Focused Window',
    description: 'Get the currently focused window label',
  },
] as const;
