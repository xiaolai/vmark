/**
 * MCP Bridge Control Hook
 *
 * Provides React state and controls for the VMark MCP bridge (WebSocket server).
 * AI clients (Claude Code, Codex, etc.) spawn their own sidecars that connect to this bridge.
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { safeUnlistenAsync } from "@/utils/safeUnlisten";

interface McpServerStatus {
  running: boolean;
  port: number | null;
}

interface UseMcpServerResult {
  /** Whether the server is currently running */
  running: boolean;
  /** The actual port the bridge is running on (null if not running) */
  port: number | null;
  /** Whether an operation is in progress */
  loading: boolean;
  /** Error message if the last operation failed */
  error: string | null;
  /** Start the MCP bridge (port is auto-assigned) */
  start: () => Promise<void>;
  /** Stop the MCP bridge */
  stop: () => Promise<void>;
  /** Refresh the bridge status. Returns the fetched status or null on error. */
  refresh: () => Promise<McpServerStatus | null>;
}

/**
 * Hook to control the VMark MCP bridge.
 *
 * The bridge is a WebSocket server that AI client sidecars connect to.
 * VMark only starts the bridge; AI clients spawn their own sidecars.
 *
 * The port is automatically assigned by the OS and written to the app data
 * directory (mcp-port file) for sidecar discovery. Users don't need to configure it.
 *
 * Usage:
 * ```tsx
 * const { running, port, loading, error, start, stop } = useMcpServer();
 *
 * // Start the bridge (port auto-assigned)
 * await start();
 *
 * // Stop the bridge
 * await stop();
 * ```
 */
export function useMcpServer(): UseMcpServerResult {
  const [running, setRunning] = useState(false);
  const [port, setPort] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial status. Returns the fetched status for callers that need fresh values.
  const refresh = useCallback(async (): Promise<McpServerStatus | null> => {
    try {
      const status = await invoke<McpServerStatus>("mcp_server_status");
      setRunning(status.running);
      setPort(status.port);
      setError(null);
      return status;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  // Start the bridge (port is auto-assigned by OS)
  const start = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Port parameter is ignored - OS assigns an available port
      const status = await invoke<McpServerStatus>("mcp_bridge_start", { port: 0 });
      setRunning(status.running);
      setPort(status.port);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Stop the bridge
  const stop = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await invoke<McpServerStatus>("mcp_bridge_stop");
      setRunning(status.running);
      setPort(status.port);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Subscribe to server events
  useEffect(() => {
    refresh();

    const unlistenStarted = listen<number>("mcp-server:started", () => {
      setRunning(true);
      setError(null);
    });

    const unlistenStopped = listen("mcp-server:stopped", () => {
      setRunning(false);
    });

    return () => {
      safeUnlistenAsync(unlistenStarted);
      safeUnlistenAsync(unlistenStopped);
    };
  }, [refresh]);

  return {
    running,
    port,
    loading,
    error,
    start,
    stop,
    refresh,
  };
}
