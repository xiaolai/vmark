/**
 * MCP Server Auto-Start Hook
 *
 * Purpose: Starts the MCP bridge server on app launch if autoStart is
 *   enabled in settings — called once from the main document window.
 *
 * @coordinates-with settingsStore.ts — reads mcp.autoStart setting
 * @module hooks/useMcpAutoStart
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
    // Only run once per app session — guard unconditionally to prevent
    // repeated invoke calls on component remounts.
    if (hasTriedRef.current) return;
    hasTriedRef.current = true;

    const { mcpServer } = useSettingsStore.getState().advanced;

    // Only auto-start if enabled
    if (!mcpServer.autoStart) return;

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
