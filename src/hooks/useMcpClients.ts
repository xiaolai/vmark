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

/** A connected MCP client with its name and optional version. */
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
      // Legitimate: clears the list as part of a cancellable async fetch gated on
      // mcpRunning, not derivable during render (#1063).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClients([]);
      return;
    }

    let cancelled = false;

    const fetchClients = async () => {
      try {
        const list = await invoke<McpClient[]>("mcp_bridge_connected_clients");
        /* v8 ignore start -- cancelled=true race: cleanup runs before async completes */
        if (!cancelled) setClients(list);
        /* v8 ignore stop */
      } catch {
        /* v8 ignore start -- cancelled=true race: cleanup runs before async completes */
        if (!cancelled) setClients([]);
        /* v8 ignore stop */
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
