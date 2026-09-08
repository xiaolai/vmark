/**
 * MCP Health Check Hook
 *
 * Purpose: Provides health check for the MCP server — runs the sidecar
 *   with --health-check flag to get real tool count and version data
 *   for the settings panel MCP status display.
 *
 * @coordinates-with stores/mcpStore.ts — stores health check results
 * @coordinates-with useMcpServer.ts — reads server running state
 * @module hooks/useMcpHealthCheck
 */

import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useMcpStore } from "@/stores/mcpStore";
import { useMcpServer } from "./useMcpServer";
import { commandErrorMessage } from "@/services/commands/commandError";

/** Health check result from sidecar */
interface SidecarHealthInfo {
  status: string;
  version: string;
  toolCount: number;
  resourceCount: number;
  tools: string[];
  error?: string;
}

/** Result of an MCP server health check including version, tool/resource counts, and bridge status. */
export interface HealthCheckResult {
  success: boolean;
  version: string;
  toolCount: number;
  resourceCount: number;
  bridgeRunning: boolean;
  bridgePort: number | null;
  error?: string;
}

/** The bridge half of a health check, as of the moment it was last read. */
interface BridgeStatus {
  running: boolean;
  port: number | null;
}

/**
 * Adopt a refresh's answer, or keep what was already known when it had none.
 *
 * `fresh ? fresh.port : previous.port`, never `fresh?.port ?? previous.port`
 * (audit #743): a STOPPED bridge legitimately reports `port: null`, and `??`
 * reads that as "absent" and substitutes the previous port — so a bridge that
 * had just stopped was reported with the port nothing is listening on any more.
 * `running` never had the bug (`false ?? x` is `false`), which is exactly why
 * one field could be wrong for so long beside a correct one.
 */
export function latestBridgeStatus(
  fresh: { running: boolean; port: number | null } | null,
  previous: BridgeStatus,
): BridgeStatus {
  return fresh ? { running: fresh.running, port: fresh.port } : previous;
}

/**
 * Hook to perform MCP server health checks.
 * Uses the sidecar --health-check command to get real data.
 *
 * Three things this owns that a single straight-line body kept getting wrong:
 *   - the bridge status is read AFTER the sidecar call as well as before
 *     (audit #741) — the sidecar round trip is the long one, and the verdict
 *     describes the bridge at the END of the check, not the start;
 *   - the result and the stored health are built ONCE (audit #744), so the
 *     success and failure branches cannot drift a field apart; and
 *   - concurrent checks are generation-stamped and counted (audit #739): only
 *     the LATEST run writes the store, and `isChecking` clears when the last
 *     one settles, not the first.
 */
export function useMcpHealthCheck() {
  const { t } = useTranslation("dialog");
  // Use individual selectors for reactive values
  const isChecking = useMcpStore((state) => state.health.isChecking);
  const health = useMcpStore((state) => state.health.health);

  const { running, port, refresh } = useMcpServer();

  // The latest health check's generation, and how many are still in flight.
  // Same shape `useMcpServer` uses for its own bridge mutations (#382/#383).
  const runGeneration = useRef(0);
  const pendingChecks = useRef(0);

  const runHealthCheck = useCallback(async (): Promise<HealthCheckResult> => {
    const { setHealth, setIsChecking } = useMcpStore.getState();
    const generation = ++runGeneration.current;
    /** A later check began: it owns the store, this one only returns its value. */
    const isLatest = () => generation === runGeneration.current;
    pendingChecks.current += 1;
    setIsChecking(true);

    // The render-time bridge status, superseded by every refresh that answers.
    // Declared OUTSIDE the try (audit #745): when the sidecar call below fails
    // after the refresh succeeded, the catch used to report the closure's
    // `running`/`port` — the values from the render that created this callback
    // — and so described a bridge state this very call had already superseded.
    let bridge: BridgeStatus = { running, port };

    /** Write this check's outcome to the store, unless a newer one owns it. */
    const publish = (
      partial: Parameters<typeof setHealth>[0],
    ): void => {
      if (isLatest()) setHealth(partial);
    };

    try {
      bridge = latestBridgeStatus(await refresh(), bridge);
      const sidecarHealth = await invoke<SidecarHealthInfo>("mcp_sidecar_health");
      // Re-read AFTER the sidecar call (audit #741). The bridge can start or
      // stop while the sidecar is being probed, and the pre-call snapshot then
      // describes a bridge state the check itself outlived.
      bridge = latestBridgeStatus(await refresh(), bridge);

      const sidecarOk = sidecarHealth.status === "ok";
      // ONE decision about what went wrong, used by both the returned result
      // and the stored health (audit #744). `undefined` is the success signal
      // callers read alongside `success`; the store spells the same thing null.
      const error = sidecarOk
        ? bridge.running
          ? undefined
          : t("mcp.bridgeNotRunning")
        : sidecarHealth.error || t("mcp.healthCheckFailed");

      publish({
        version: sidecarHealth.version,
        toolCount: sidecarHealth.toolCount,
        resourceCount: sidecarHealth.resourceCount,
        tools: sidecarHealth.tools,
        lastChecked: new Date(),
        checkError: error ?? null,
      });

      return {
        success: sidecarOk && bridge.running,
        version: sidecarHealth.version,
        toolCount: sidecarHealth.toolCount,
        resourceCount: sidecarHealth.resourceCount,
        bridgeRunning: bridge.running,
        bridgePort: bridge.port,
        // No `error` key on a healthy result — its absence is the success
        // signal callers read alongside `success`.
        ...(error === undefined ? {} : { error }),
      };
    } catch (err) {
      const error = commandErrorMessage(err);
      // Use getState() to avoid stale closure issues
      const currentHealth = useMcpStore.getState().health.health;
      publish({ lastChecked: new Date(), checkError: error });
      return {
        success: false,
        version: currentHealth.version || "unknown",
        toolCount: currentHealth.toolCount || 0,
        resourceCount: currentHealth.resourceCount || 0,
        bridgeRunning: bridge.running,
        bridgePort: bridge.port,
        error,
      };
    } finally {
      pendingChecks.current -= 1;
      // The LAST check to settle clears the flag (audit #739): an unconditional
      // clear in a `finally` let the first of two overlapping checks report
      // "done" while the second was still running, and the spinner stopped.
      if (pendingChecks.current === 0) setIsChecking(false);
    }
  }, [running, port, refresh, t]);

  return {
    runHealthCheck,
    isChecking,
    // Return values from store, not hardcoded
    version: health.version,
    toolCount: health.toolCount,
    resourceCount: health.resourceCount,
  };
}
