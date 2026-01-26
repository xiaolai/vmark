/**
 * Integrations Settings Section
 *
 * MCP server and AI assistant integration settings.
 */

import { SettingRow, Toggle, SettingsGroup, CopyButton } from "./components";
import { useSettingsStore } from "@/stores/settingsStore";
import { useMcpServer } from "@/hooks/useMcpServer";
import { McpConfigInstaller } from "./McpConfigInstaller";

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
          </div>
        )}
      </SettingsGroup>

      <div className="mt-6">
        <McpConfigInstaller onInstallSuccess={handleMcpConfigInstalled} />
      </div>
    </div>
  );
}
