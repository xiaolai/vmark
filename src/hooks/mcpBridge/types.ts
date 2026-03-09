/**
 * MCP Bridge Types
 *
 * Purpose: TypeScript interfaces for the MCP bridge request/response protocol —
 *   defines the shape of events flowing between Rust and frontend handlers.
 *
 * @module hooks/mcpBridge/types
 */

/** Raw event from Tauri IPC - args is JSON string to avoid double-encoding */
export interface McpRequestEventRaw {
  id: string;
  type: string;
  /** Snake case (as defined in Rust) */
  args_json?: string;
  /** CamelCase (Tauri might convert) */
  argsJson?: string;
}

/** Parsed event with args as object */
export interface McpRequestEvent {
  id: string;
  type: string;
  args: Record<string, unknown>;
}

export interface McpResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// Shared operation mode — 'apply'/'suggest' accepted for backward compat but ignored;
// only 'dryRun' has effect. Apply-vs-suggest is controlled by autoApproveEdits.
export type OperationMode = "apply" | "suggest" | "dryRun";
export const OPERATION_MODES = ["apply", "suggest", "dryRun"] as const;

export type MatchPolicy = "first" | "all" | "nth" | "error_if_multiple";
export const MATCH_POLICIES = ["first", "all", "nth", "error_if_multiple"] as const;
