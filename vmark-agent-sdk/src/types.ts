/**
 * Type definitions for VMark Agent SDK
 */

// IPC Request types
export interface IpcRequest {
  type: "query" | "ping" | "check_claude" | "cancel";
  id: string;
  prompt?: string;
  options?: QueryOptions;
}

// Query options passed from Tauri
export interface QueryOptions {
  maxTurns?: number;
  allowedTools?: string[];
  model?: "sonnet" | "haiku" | "opus";
  systemPrompt?: string;
}

// IPC Response types
export type IpcResponseType =
  | "result"
  | "stream"
  | "error"
  | "pong"
  | "claude_status"
  | "cancelled";

export interface IpcResponse {
  type: IpcResponseType;
  id: string;
  content?: string;
  done?: boolean;
  installed?: boolean;
  version?: string;
  path?: string;
}

// Claude Code status
export interface ClaudeStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

// Agent request from frontend
export interface AgentRequest {
  id: string;
  prompt: string;
  options?: QueryOptions;
}

// Streaming message from agent
export interface StreamMessage {
  type: "stream";
  id: string;
  content: string;
  done: false;
}

// Final result from agent
export interface ResultMessage {
  type: "result";
  id: string;
  content: string;
  done: true;
}

// Error from agent
export interface ErrorMessage {
  type: "error";
  id: string;
  content: string;
}

export type AgentMessage = StreamMessage | ResultMessage | ErrorMessage;

// MCP Server configuration
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// Default allowed tools for VMark operations
export const DEFAULT_VMARK_TOOLS = [
  "mcp__vmark__document_get_content",
  "mcp__vmark__document_set_content",
  "mcp__vmark__document_insert_at_cursor",
  "mcp__vmark__document_insert_at_position",
  "mcp__vmark__document_search",
  "mcp__vmark__document_replace",
  "mcp__vmark__selection_get",
  "mcp__vmark__selection_set",
  "mcp__vmark__selection_replace",
  "mcp__vmark__selection_delete",
  "mcp__vmark__cursor_get_context",
  "mcp__vmark__cursor_set_position",
] as const;

// Subset of tools for read-only operations
export const READONLY_VMARK_TOOLS = [
  "mcp__vmark__document_get_content",
  "mcp__vmark__document_search",
  "mcp__vmark__selection_get",
  "mcp__vmark__cursor_get_context",
] as const;

// Subset of tools for writing/editing operations
export const WRITE_VMARK_TOOLS = [
  "mcp__vmark__selection_get",
  "mcp__vmark__selection_replace",
  "mcp__vmark__document_insert_at_cursor",
] as const;
