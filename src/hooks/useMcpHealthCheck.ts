/**
 * MCP Health Check Hook
 *
 * Provides health check functionality for the MCP server.
 * Runs the sidecar with --health-check to get real tool/version data.
 */

import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useMcpHealthStore } from "@/stores/mcpHealthStore";
import { useMcpServer } from "./useMcpServer";

/** Health check result from sidecar */
interface SidecarHealthInfo {
  status: string;
  version: string;
  toolCount: number;
  resourceCount: number;
  tools: string[];
  error?: string;
}

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
 * Uses the sidecar --health-check command to get real data.
 */
export function useMcpHealthCheck() {
  // Use individual selectors for reactive values
  const isChecking = useMcpHealthStore((state) => state.isChecking);
  const health = useMcpHealthStore((state) => state.health);

  const { running, port, refresh } = useMcpServer();

  const runHealthCheck = useCallback(async (): Promise<HealthCheckResult> => {
    const { setHealth, setIsChecking } = useMcpHealthStore.getState();
    setIsChecking(true);

    try {
      // Refresh bridge status first
      await refresh();

      // Run sidecar health check to get real data
      const sidecarHealth = await invoke<SidecarHealthInfo>("mcp_sidecar_health");

      const bridgeRunning = running;
      const bridgePort = port;

      if (sidecarHealth.status === "ok") {
        const result: HealthCheckResult = {
          success: bridgeRunning,
          version: sidecarHealth.version,
          toolCount: sidecarHealth.toolCount,
          resourceCount: sidecarHealth.resourceCount,
          bridgeRunning,
          bridgePort,
          error: bridgeRunning ? undefined : "MCP bridge is not running",
        };

        setHealth({
          version: sidecarHealth.version,
          toolCount: sidecarHealth.toolCount,
          resourceCount: sidecarHealth.resourceCount,
          tools: sidecarHealth.tools,
          lastChecked: new Date(),
          checkError: bridgeRunning ? null : "MCP bridge is not running",
        });

        return result;
      } else {
        // Sidecar reported an error
        const error = sidecarHealth.error || "Sidecar health check failed";
        const result: HealthCheckResult = {
          success: false,
          version: sidecarHealth.version,
          toolCount: sidecarHealth.toolCount,
          resourceCount: sidecarHealth.resourceCount,
          bridgeRunning,
          bridgePort,
          error,
        };

        setHealth({
          version: sidecarHealth.version,
          toolCount: sidecarHealth.toolCount,
          resourceCount: sidecarHealth.resourceCount,
          tools: sidecarHealth.tools,
          lastChecked: new Date(),
          checkError: error,
        });

        return result;
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // Use getState() to avoid stale closure issues
      const currentHealth = useMcpHealthStore.getState().health;
      const result: HealthCheckResult = {
        success: false,
        version: currentHealth.version || "unknown",
        toolCount: currentHealth.toolCount || 0,
        resourceCount: currentHealth.resourceCount || 0,
        bridgeRunning: running,
        bridgePort: port,
        error,
      };

      setHealth({
        lastChecked: new Date(),
        checkError: error,
      });

      return result;
    } finally {
      setIsChecking(false);
    }
  }, [running, port, refresh]);

  return {
    runHealthCheck,
    isChecking,
    // Return values from store, not hardcoded
    version: health.version,
    toolCount: health.toolCount,
    resourceCount: health.resourceCount,
  };
}
