/**
 * MCP Integration for VMark Agent SDK
 *
 * Configures the Agent SDK to use vmark-mcp-server for editor tools.
 * The MCP server connects to the running VMark instance via the bridge.
 */

import type { McpServerConfig } from "./types.js";
import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

// Port file location (written by VMark when bridge starts)
const VMARK_PORT_FILE = join(homedir(), ".vmark", "mcp-port");

/**
 * Read the VMark MCP bridge port from the port file
 */
export async function getVmarkBridgePort(): Promise<number | null> {
  try {
    const content = await readFile(VMARK_PORT_FILE, "utf-8");
    const port = parseInt(content.trim(), 10);
    return isNaN(port) ? null : port;
  } catch {
    return null;
  }
}

/**
 * Check if VMark bridge is running
 */
export async function isVmarkBridgeRunning(): Promise<boolean> {
  const port = await getVmarkBridgePort();
  return port !== null;
}

/**
 * Get MCP server configuration for vmark-mcp-server
 *
 * The vmark-mcp-server binary is expected to be in one of:
 * 1. Environment variable VMARK_MCP_SERVER_PATH
 * 2. Same directory as this sidecar (bundled)
 * 3. PATH (global install)
 */
export function getVmarkMcpServerConfig(): McpServerConfig {
  // Check for explicit path
  const explicitPath = process.env.VMARK_MCP_SERVER_PATH;
  if (explicitPath) {
    return {
      command: explicitPath,
      args: [],
    };
  }

  // Default to assuming it's in PATH or bundled
  return {
    command: "vmark-mcp-server",
    args: [],
  };
}

/**
 * Build MCP servers configuration for Agent SDK
 *
 * Returns configuration for vmark-mcp-server if the bridge is running,
 * otherwise returns empty config.
 */
export async function buildMcpServersConfig(): Promise<
  Record<string, McpServerConfig>
> {
  const bridgeRunning = await isVmarkBridgeRunning();

  if (!bridgeRunning) {
    console.error(
      "[vmark-agent-sdk] VMark bridge not running, MCP tools unavailable"
    );
    return {};
  }

  return {
    vmark: getVmarkMcpServerConfig(),
  };
}

/**
 * Tool allowlist presets for common operations
 */
export const TOOL_PRESETS = {
  // Read-only operations (safe)
  readonly: [
    "mcp__vmark__document_get_content",
    "mcp__vmark__document_search",
    "mcp__vmark__selection_get",
    "mcp__vmark__cursor_get_context",
  ],

  // Selection-based editing (most common)
  selection: [
    "mcp__vmark__selection_get",
    "mcp__vmark__selection_replace",
    "mcp__vmark__cursor_get_context",
  ],

  // Full document editing
  document: [
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
  ],

  // Research operations (read + web search)
  research: [
    "mcp__vmark__document_get_content",
    "mcp__vmark__selection_get",
    "mcp__vmark__cursor_get_context",
    "mcp__vmark__document_insert_at_cursor",
    "WebSearch",
    "WebFetch",
  ],

  // All VMark tools
  all: [
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
    "mcp__vmark__editor_undo",
    "mcp__vmark__editor_redo",
    "mcp__vmark__format_toggle",
    "mcp__vmark__format_set_link",
    "mcp__vmark__format_remove_link",
    "mcp__vmark__format_clear",
    "mcp__vmark__block_set_type",
    "mcp__vmark__block_toggle",
    "mcp__vmark__list_toggle",
    "mcp__vmark__table_insert",
  ],
} as const;

export type ToolPreset = keyof typeof TOOL_PRESETS;

/**
 * Get allowed tools for a preset or custom list
 */
export function getAllowedTools(
  presetOrTools: ToolPreset | string[]
): string[] {
  if (Array.isArray(presetOrTools)) {
    return presetOrTools;
  }
  return [...TOOL_PRESETS[presetOrTools]];
}
