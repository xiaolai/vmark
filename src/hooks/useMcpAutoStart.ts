/**
 * MCP Server Auto-Start Hook
 *
 * Starts the MCP server on app launch if autoStart is enabled.
 * Should be called only once from the main window.
 */

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Auto-start the MCP server if enabled in settings.
 *
 * This hook should be called in the main document window (not settings or other windows).
 * It uses a ref to ensure it only runs once per app session.
 */
export function useMcpAutoStart() {
  const hasTriedRef = useRef(false);

  useEffect(() => {
    // Only run once per app session
    if (hasTriedRef.current) return;
    hasTriedRef.current = true;

    const { mcpServer } = useSettingsStore.getState().advanced;

    // Only auto-start if enabled
    if (!mcpServer.autoStart) return;

    // Start the MCP server
    invoke("mcp_server_start", { port: mcpServer.port })
      .then(() => {
        console.log("[MCP] Auto-started MCP server on port", mcpServer.port);
      })
      .catch((error) => {
        console.error("[MCP] Failed to auto-start MCP server:", error);
      });
  }, []);
}
