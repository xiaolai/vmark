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

    const { mcpServer } = useSettingsStore.getState().advanced;

    // Only auto-start if enabled (don't set hasTriedRef if disabled,
    // so re-enabling the setting and remounting can still trigger auto-start)
    if (!mcpServer.autoStart) return;

    hasTriedRef.current = true;

    // Start only the MCP bridge (WebSocket server).
    // AI clients (Claude Code, Codex, etc.) spawn their own sidecars that connect to this bridge.
    // We don't start a local sidecar - that would conflict with the AI client's sidecar.
    invoke("mcp_bridge_start", { port: mcpServer.port })
      .then(() => {
        console.log("[MCP] Auto-started MCP bridge on port", mcpServer.port);
      })
      .catch((error) => {
        console.error("[MCP] Failed to auto-start MCP bridge:", error);
      });
  }, []);
}
