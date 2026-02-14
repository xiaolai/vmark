/**
 * MCP Connected Clients Hook
 *
 * Purpose: Tracks which AI clients (Claude Code, Codex, etc.) are connected
 *   to the MCP bridge — listens to real-time connect/disconnect events
 *   for status bar display.
 *
 * @coordinates-with mcpHealthStore.ts — stores client list for UI
 * @module hooks/useMcpClients
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";

export interface McpClient {
  name: string;
  version: string | null;
}

/**
 * Returns the list of currently connected MCP clients.
 * Automatically updates when clients connect or disconnect.
 *
 * @param mcpRunning - Whether the MCP bridge is running
 */
export function useMcpClients(mcpRunning: boolean): McpClient[] {
  const [clients, setClients] = useState<McpClient[]>([]);

  useEffect(() => {
    if (!mcpRunning) {
      setClients([]);
      return;
    }

    let cancelled = false;

    const fetchClients = async () => {
      try {
        const list = await invoke<McpClient[]>("mcp_bridge_connected_clients");
        if (!cancelled) setClients(list);
      } catch {
        if (!cancelled) setClients([]);
      }
    };

    fetchClients();

    const unlistenPromise = listen("mcp-bridge:clients-changed", () => {
      fetchClients();
    });

    return () => {
      cancelled = true;
      safeUnlistenAsync(unlistenPromise);
    };
  }, [mcpRunning]);

  return clients;
}
