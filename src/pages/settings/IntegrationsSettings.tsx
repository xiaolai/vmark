/**
 * Integrations Settings Section
 *
 * MCP server and AI assistant integration settings.
 */

import { useState } from "react";
import { SettingRow, Toggle, SettingsGroup } from "./components";
import { useSettingsStore } from "@/stores/settingsStore";
import { useMcpServer } from "@/hooks/useMcpServer";

function StatusBadge({ running, loading }: { running: boolean; loading: boolean }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
        <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
        Starting...
      </span>
    );
  }

  if (running) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        Running
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
      <span className="w-2 h-2 rounded-full bg-gray-400" />
      Stopped
    </span>
  );
}

export function IntegrationsSettings() {
  const mcpSettings = useSettingsStore((state) => state.advanced.mcpServer);
  const updateAdvancedSetting = useSettingsStore((state) => state.updateAdvancedSetting);

  const { running, loading, error, start, stop } = useMcpServer();

  // Local state for port input (allows editing without immediate effect)
  const [portInput, setPortInput] = useState(String(mcpSettings.port));
  const [portError, setPortError] = useState<string | null>(null);

  const handleToggleServer = async (enabled: boolean) => {
    if (enabled) {
      const port = parseInt(portInput, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        setPortError("Port must be between 1 and 65535");
        return;
      }
      setPortError(null);
      try {
        await start(port);
        // Save port to settings on successful start
        updateAdvancedSetting("mcpServer", { ...mcpSettings, port });
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

  const handlePortChange = (value: string) => {
    setPortInput(value);
    setPortError(null);

    const port = parseInt(value, 10);
    if (!isNaN(port) && port >= 1 && port <= 65535) {
      updateAdvancedSetting("mcpServer", { ...mcpSettings, port });
    }
  };

  const handleAutoStartChange = (enabled: boolean) => {
    updateAdvancedSetting("mcpServer", { ...mcpSettings, autoStart: enabled });
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
        Integrations
      </h2>

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
          label="WebSocket Port"
          description="Port for AI connections (default: 9224)"
          disabled={running}
        >
          <input
            type="number"
            min={1}
            max={65535}
            value={portInput}
            onChange={(e) => handlePortChange(e.target.value)}
            disabled={running || loading}
            className={`w-20 px-2 py-1 rounded border text-sm text-right
                       bg-[var(--bg-primary)] text-[var(--text-primary)]
                       ${portError ? "border-red-500" : "border-gray-200 dark:border-gray-700"}
                       ${running || loading ? "opacity-50 cursor-not-allowed" : ""}`}
          />
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

        {(error || portError) && (
          <div className="mt-2 text-xs text-red-500">
            {error || portError}
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-[var(--text-tertiary)]">
            Connect AI assistants to{" "}
            <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] font-mono">
              localhost:{mcpSettings.port}
            </code>
          </div>
        </div>
      </SettingsGroup>
    </div>
  );
}
