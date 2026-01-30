/**
 * Integrations Settings Section
 *
 * MCP server and AI assistant integration settings.
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingRow, Toggle, SettingsGroup, CopyButton } from "./components";
import { useSettingsStore } from "@/stores/settingsStore";
import { useMcpServer } from "@/hooks/useMcpServer";
import { useMcpHealthCheck } from "@/hooks/useMcpHealthCheck";
import { useMcpHealthStore } from "@/stores/mcpHealthStore";
import { McpConfigInstaller } from "./McpConfigInstaller";
import { RefreshCw, Users, ExternalLink } from "lucide-react";

function StatusBadge({ running, loading }: { running: boolean; loading: boolean }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
        <span className="w-2 h-2 rounded-full bg-[var(--warning-color)] animate-pulse" />
        Starting...
      </span>
    );
  }

  if (running) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--success-color)]">
        <span className="w-2 h-2 rounded-full bg-[var(--success-color)]" />
        Running
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
      <span className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />
      Stopped
    </span>
  );
}

export function IntegrationsSettings() {
  const mcpSettings = useSettingsStore((state) => state.advanced.mcpServer);
  const updateAdvancedSetting = useSettingsStore((state) => state.updateAdvancedSetting);

  const { running, port, loading, error, start, stop } = useMcpServer();
  const { runHealthCheck, isChecking, version, toolCount, resourceCount } = useMcpHealthCheck();
  const health = useMcpHealthStore((state) => state.health);

  const [clientCount, setClientCount] = useState(0);

  // Fetch client count when bridge is running
  useEffect(() => {
    if (!running) {
      setClientCount(0);
      return;
    }

    const fetchClientCount = async () => {
      try {
        const count = await invoke<number>("mcp_bridge_client_count");
        setClientCount(count);
      } catch {
        // Ignore errors
      }
    };

    fetchClientCount();
    // Poll every 5 seconds while running
    const interval = setInterval(fetchClientCount, 5000);
    return () => clearInterval(interval);
  }, [running]);

  const handleToggleServer = async (enabled: boolean) => {
    if (enabled) {
      try {
        await start();
      } catch {
        // Error is handled by hook
      }
    } else {
      try {
        await stop();
      } catch {
        // Error is handled by hook
      }
    }
  };

  const handleAutoStartChange = (enabled: boolean) => {
    updateAdvancedSetting("mcpServer", { ...mcpSettings, autoStart: enabled });
  };

  const handleAutoApproveChange = (enabled: boolean) => {
    updateAdvancedSetting("mcpServer", { ...mcpSettings, autoApproveEdits: enabled });
  };

  // Called after MCP config is successfully installed to a provider
  // Enables autoStart and starts the bridge so it works immediately
  const handleMcpConfigInstalled = async () => {
    // Enable autoStart so bridge runs on future launches
    if (!mcpSettings.autoStart) {
      updateAdvancedSetting("mcpServer", { ...mcpSettings, autoStart: true });
    }
    // Start the bridge now if not already running
    if (!running && !loading) {
      try {
        await start();
      } catch {
        // Error handled by hook, user can see status indicator
      }
    }
  };

  return (
    <div>
      <SettingsGroup title="MCP Server">
        <SettingRow
          label="Enable MCP Server"
          description="Allow AI assistants to control VMark editor"
        >
          <div className="flex items-center gap-3">
            <StatusBadge running={running} loading={loading} />
            <Toggle
              checked={running}
              onChange={handleToggleServer}
              disabled={loading}
            />
          </div>
        </SettingRow>

        <SettingRow
          label="Start on launch"
          description="Auto-start when VMark opens"
        >
          <Toggle
            checked={mcpSettings.autoStart}
            onChange={handleAutoStartChange}
          />
        </SettingRow>

        <SettingRow
          label="Auto-approve edits"
          description="Apply AI changes without preview (use with caution)"
        >
          <Toggle
            checked={mcpSettings.autoApproveEdits}
            onChange={handleAutoApproveChange}
          />
        </SettingRow>

        {error && (
          <div className="mt-2 text-xs text-[var(--error-color)]">
            {error}
          </div>
        )}

        {health.checkError && !error && (
          <div className="mt-2 text-xs text-[var(--error-color)]">
            Health check: {health.checkError}
          </div>
        )}

        {/* Server info - show when running */}
        {running && port && (
          <div className="mt-4 pt-3 border-t border-[var(--border-color)]">
            <div className="text-xs text-[var(--text-tertiary)] flex items-center gap-1.5">
              <span>Listening on</span>
              <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] font-mono">
                localhost:{port}
              </code>
              <CopyButton text={`localhost:${port}`} />
            </div>
            <div className="text-xs text-[var(--text-tertiary)] mt-1">
              Port auto-assigned. AI clients discover it automatically.
            </div>

            {/* Server info */}
            <div className="mt-3 pt-3 border-t border-[var(--border-color)]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-tertiary)]">Version</span>
                <code className="text-[var(--text-secondary)] font-mono">{version ?? "—"}</code>
              </div>

              <div className="flex items-center justify-between text-xs mt-1.5">
                <span className="text-[var(--text-tertiary)]">Tools Available</span>
                <a
                  href="https://vmark.app/guide/mcp-tools"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[var(--primary-color)] hover:underline"
                >
                  {toolCount ?? "—"} tools
                  <ExternalLink size={10} />
                </a>
              </div>

              <div className="flex items-center justify-between text-xs mt-1.5">
                <span className="text-[var(--text-tertiary)]">Resources Available</span>
                <span className="text-[var(--text-secondary)]">{resourceCount ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1.5">
                <span className="flex items-center gap-1 text-[var(--text-tertiary)]">
                  <Users size={12} />
                  Connected Clients
                </span>
                <span className={clientCount > 0 ? "text-[var(--success-color)]" : "text-[var(--text-secondary)]"}>
                  {clientCount}
                </span>
              </div>
              {health.lastChecked && (
                <div className="flex items-center justify-between text-xs mt-1.5">
                  <span className="text-[var(--text-tertiary)]">Last Checked</span>
                  <span className="text-[var(--text-secondary)]">
                    {health.lastChecked.toLocaleTimeString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Diagnostics section - always visible */}
        <div className="mt-4 pt-3 border-t border-[var(--border-color)]">
          <div className="flex items-center justify-between">
            <button
              onClick={() => runHealthCheck()}
              disabled={isChecking}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md
                bg-[var(--bg-tertiary)] text-[var(--text-secondary)]
                hover:bg-[var(--hover-bg-strong)] hover:text-[var(--text-color)]
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors"
            >
              <RefreshCw size={12} className={isChecking ? "animate-spin" : ""} />
              {running ? "Test Connection" : "Check Sidecar"}
            </button>
            {!running && health.version && (
              <span className="text-xs text-[var(--text-tertiary)]">
                Sidecar v{health.version} • {health.toolCount} tools
              </span>
            )}
          </div>
        </div>
      </SettingsGroup>

      <div className="mt-6">
        <McpConfigInstaller onInstallSuccess={handleMcpConfigInstalled} />
      </div>
    </div>
  );
}
