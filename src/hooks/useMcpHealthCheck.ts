/**
 * MCP Health Check Hook
 *
 * Provides health check functionality for the MCP server.
 * Validates bridge connectivity and reports tool/resource counts.
 */

import { useCallback } from "react";
import { useMcpHealthStore } from "@/stores/mcpHealthStore";
import { useMcpServer } from "./useMcpServer";

// MCP Server version (matches vmark-mcp-server/package.json)
const MCP_VERSION = "0.3.10";

// Tool count from the MCP server (matches sidecar --health-check output)
// This is the number of tools exposed via the MCP bridge
const TOOL_COUNT = 76;
const RESOURCE_COUNT = 4;

// Known tools list (from sidecar health check)
const KNOWN_TOOLS = [
  "document_get_content",
  "document_set_content",
  "document_insert_at_cursor",
  "document_insert_at_position",
  "document_search",
  "document_replace",
  "selection_get",
  "selection_set",
  "selection_replace",
  "selection_delete",
  "cursor_get_context",
  "cursor_set_position",
  "editor_undo",
  "editor_redo",
  "editor_focus",
  "format_toggle",
  "format_set_link",
  "format_remove_link",
  "format_clear",
  "block_set_type",
  "block_toggle",
  "block_insert_horizontal_rule",
  "list_toggle",
  "list_indent",
  "list_outdent",
  "table_insert",
  "table_delete",
  "table_add_row",
  "table_delete_row",
  "table_add_column",
  "table_delete_column",
  "table_toggle_header_row",
  "insert_math_inline",
  "insert_math_block",
  "insert_mermaid",
  "insert_wiki_link",
  "cjk_punctuation_convert",
  "cjk_spacing_fix",
  "workspace_list_windows",
  "workspace_get_focused",
  "workspace_focus_window",
  "workspace_new_document",
  "workspace_open_document",
  "workspace_save_document",
  "workspace_close_window",
  "workspace_save_document_as",
  "workspace_get_document_info",
  "workspace_list_recent_files",
  "workspace_get_info",
  "tabs_list",
  "tabs_get_active",
  "tabs_switch",
  "tabs_close",
  "tabs_create",
  "tabs_get_info",
  "tabs_reopen_closed",
  "suggestion_list",
  "suggestion_accept",
  "suggestion_reject",
  "suggestion_accept_all",
  "suggestion_reject_all",
  "get_capabilities",
  "get_document_revision",
  "get_document_ast",
  "get_document_digest",
  "list_blocks",
  "resolve_targets",
  "get_section",
  "batch_edit",
  "apply_diff",
  "replace_text_anchored",
  "update_section",
  "insert_section",
  "move_section",
  "table_modify",
  "list_modify",
];

export interface HealthCheckResult {
  success: boolean;
  version: string;
  toolCount: number;
  resourceCount: number;
  bridgeRunning: boolean;
  bridgePort: number | null;
  error?: string;
}

/**
 * Hook to perform MCP server health checks.
 */
export function useMcpHealthCheck() {
  const { setHealth, setIsChecking, isChecking } = useMcpHealthStore();
  const { running, port, refresh } = useMcpServer();

  const runHealthCheck = useCallback(async (): Promise<HealthCheckResult> => {
    setIsChecking(true);

    try {
      // Refresh bridge status first
      await refresh();

      // Get latest state
      const bridgeRunning = running;
      const bridgePort = port;

      if (!bridgeRunning) {
        const result: HealthCheckResult = {
          success: false,
          version: MCP_VERSION,
          toolCount: TOOL_COUNT,
          resourceCount: RESOURCE_COUNT,
          bridgeRunning: false,
          bridgePort: null,
          error: "MCP bridge is not running",
        };

        setHealth({
          version: MCP_VERSION,
          toolCount: TOOL_COUNT,
          resourceCount: RESOURCE_COUNT,
          tools: KNOWN_TOOLS,
          lastChecked: new Date(),
          checkError: result.error,
        });

        return result;
      }

      // Bridge is running - report healthy
      const result: HealthCheckResult = {
        success: true,
        version: MCP_VERSION,
        toolCount: TOOL_COUNT,
        resourceCount: RESOURCE_COUNT,
        bridgeRunning: true,
        bridgePort,
      };

      setHealth({
        version: MCP_VERSION,
        toolCount: TOOL_COUNT,
        resourceCount: RESOURCE_COUNT,
        tools: KNOWN_TOOLS,
        lastChecked: new Date(),
        checkError: null,
      });

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const result: HealthCheckResult = {
        success: false,
        version: MCP_VERSION,
        toolCount: TOOL_COUNT,
        resourceCount: RESOURCE_COUNT,
        bridgeRunning: false,
        bridgePort: null,
        error,
      };

      setHealth({
        version: MCP_VERSION,
        toolCount: TOOL_COUNT,
        resourceCount: RESOURCE_COUNT,
        tools: KNOWN_TOOLS,
        lastChecked: new Date(),
        checkError: error,
      });

      return result;
    } finally {
      setIsChecking(false);
    }
  }, [running, port, refresh, setHealth, setIsChecking]);

  return {
    runHealthCheck,
    isChecking,
    version: MCP_VERSION,
    toolCount: TOOL_COUNT,
    resourceCount: RESOURCE_COUNT,
  };
}
