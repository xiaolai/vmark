/**
 * Integrations Settings Section
 *
 * MCP server and AI assistant integration settings.
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { SettingRow, Toggle, SettingsGroup, CopyButton } from "./components";
import { useSettingsStore } from "@/stores/settingsStore";
import { useMcpServer } from "@/hooks/useMcpServer";
import { useMcpHealthCheck } from "@/hooks/useMcpHealthCheck";
import { useMcpStore } from "@/stores/mcpStore";
import { useAiProviderStore } from "@/stores/aiProviderStore";
import { McpConfigInstaller } from "./McpConfigInstaller";
import { RefreshCw, Users, ExternalLink } from "lucide-react";
import type { ProviderType } from "@/types/aiGenies";
import { RestProviderConfigFields } from "./RestProviderConfigFields";

function StatusBadge({ running, loading }: { running: boolean; loading: boolean }) {
  const { t } = useTranslation("settings");

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
        <span className="w-2 h-2 rounded-full bg-[var(--warning-color)] animate-pulse" />
        {t("integrations.mcpStatus.starting")}
      </span>
    );
  }

  if (running) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--success-color)]">
        <span className="w-2 h-2 rounded-full bg-[var(--success-color)]" />
        {t("integrations.mcpStatus.running")}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
      <span className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />
      {t("integrations.mcpStatus.stopped")}
    </span>
  );
}

export function IntegrationsSettings() {
  const { t } = useTranslation("settings");
  const mcpSettings = useSettingsStore((state) => state.advanced.mcpServer);
  const updateAdvancedSetting = useSettingsStore((state) => state.updateAdvancedSetting);

  const { running, port, loading, error, start, stop } = useMcpServer();
  const { runHealthCheck, isChecking, version, toolCount, resourceCount } = useMcpHealthCheck();
  const health = useMcpStore((state) => state.health.health);

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
      <SettingsGroup title={t("integrations.group.mcp")}>
        <SettingRow
          label={t("integrations.enableMcp.label")}
          description={t("integrations.enableMcp.description")}
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
          label={t("integrations.startOnLaunch.label")}
          description={t("integrations.startOnLaunch.description")}
        >
          <Toggle
            checked={mcpSettings.autoStart}
            onChange={handleAutoStartChange}
          />
        </SettingRow>

        <SettingRow
          label={t("integrations.autoApprove.label")}
          description={t("integrations.autoApprove.description")}
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
            {t("integrations.healthCheck.error", { error: health.checkError })}
          </div>
        )}

        {/* Server info - show when running */}
        {running && port && (
          <div className="mt-4 pt-3 border-t border-[var(--border-color)]">
            <div className="text-xs text-[var(--text-tertiary)] flex items-center gap-1.5">
              <span>{t("integrations.mcpInfo.listeningOn")}</span>
              <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] font-mono">
                localhost:{port}
              </code>
              <CopyButton text={`localhost:${port}`} />
            </div>
            <div className="text-xs text-[var(--text-tertiary)] mt-1">
              {t("integrations.mcpInfo.portNote")}
            </div>

            {/* Server info */}
            <div className="mt-3 pt-3 border-t border-[var(--border-color)]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-tertiary)]">{t("integrations.mcpInfo.version")}</span>
                <code className="text-[var(--text-secondary)] font-mono">{version ?? "—"}</code>
              </div>

              <div className="flex items-center justify-between text-xs mt-1.5">
                <span className="text-[var(--text-tertiary)]">{t("integrations.mcpInfo.toolsAvailable")}</span>
                <a
                  href="https://vmark.app/guide/mcp-tools"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[var(--primary-color)] hover:underline"
                >
                  {toolCount != null ? t("integrations.mcpInfo.toolsCount", { count: toolCount }) : "—"}
                  <ExternalLink size={10} />
                </a>
              </div>

              <div className="flex items-center justify-between text-xs mt-1.5">
                <span className="text-[var(--text-tertiary)]">{t("integrations.mcpInfo.resourcesAvailable")}</span>
                <span className="text-[var(--text-secondary)]">{resourceCount ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1.5">
                <span className="flex items-center gap-1 text-[var(--text-tertiary)]">
                  <Users size={12} />
                  {t("integrations.mcpInfo.connectedClients")}
                </span>
                <span className={clientCount > 0 ? "text-[var(--success-color)]" : "text-[var(--text-secondary)]"}>
                  {clientCount}
                </span>
              </div>
              {health.lastChecked && (
                <div className="flex items-center justify-between text-xs mt-1.5">
                  <span className="text-[var(--text-tertiary)]">{t("integrations.mcpInfo.lastChecked")}</span>
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
              {running ? t("integrations.mcpDiag.testConnection") : t("integrations.mcpDiag.checkSidecar")}
            </button>
            {!running && health.version && (
              <span className="text-xs text-[var(--text-tertiary)]">
                {t("integrations.mcpDiag.sidecarInfo", { version: health.version, count: health.toolCount ?? 0 })}
              </span>
            )}
          </div>
        </div>
      </SettingsGroup>

      <div className="mt-6">
        <McpConfigInstaller onInstallSuccess={handleMcpConfigInstalled} />
      </div>

      <div className="mt-6">
        <AiProviderSettings />
      </div>

    </div>
  );
}

// ============================================================================
// AI Provider Settings
// ============================================================================

function ProviderRadio({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`w-3.5 h-3.5 rounded-full border flex-shrink-0
        flex items-center justify-center transition-colors
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
        ${checked
          ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]"
          : "border-[var(--text-tertiary)] bg-transparent hover:border-[var(--text-secondary)]"
        }`}
    >
      {checked && (
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--contrast-text)]" />
      )}
    </button>
  );
}

function AiProviderSettings() {
  const { t } = useTranslation("settings");
  const cliProviders = useAiProviderStore((s) => s.cliProviders);
  const restProviders = useAiProviderStore((s) => s.restProviders);
  const activeProvider = useAiProviderStore((s) => s.activeProvider);
  const detecting = useAiProviderStore((s) => s.detecting);

  // Auto-detect CLI providers when settings page mounts so users
  // immediately see available CLIs without clicking "Detect"
  useEffect(() => {
    useAiProviderStore.getState().detectProviders();
  }, []);

  const handleDetect = () => {
    useAiProviderStore.getState().detectProviders();
  };

  const handleActivate = (type: ProviderType) => {
    useAiProviderStore.getState().activateProvider(type);
  };

  return (
    <SettingsGroup title={t("integrations.group.aiProviders")}>
      <SettingRow
        label={t("integrations.detectCli.label")}
        description={t("integrations.detectCli.description")}
      >
        <button
          onClick={handleDetect}
          disabled={detecting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md
            bg-[var(--bg-tertiary)] text-[var(--text-secondary)]
            hover:bg-[var(--hover-bg-strong)] hover:text-[var(--text-color)]
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors"
        >
          <RefreshCw size={12} className={detecting ? "animate-spin" : ""} />
          {t("integrations.detectCli.button")}
        </button>
      </SettingRow>

      {/* CLI providers */}
      {cliProviders.length > 0 && (
        <div className="mt-2 px-1" role="radiogroup" aria-label={t("integrations.aiProviders.cliProviders")}>
          <div className="text-xs text-[var(--text-tertiary)] mb-1">{t("integrations.aiProviders.cliProviders")}</div>
          {cliProviders.map((p) => (
            <div
              key={p.type}
              className={`flex items-center gap-2 text-xs py-1.5 ${
                !p.available ? "opacity-50" : "cursor-pointer"
              }`}
              onClick={() => p.available && handleActivate(p.type)}
            >
              <ProviderRadio
                checked={activeProvider === p.type}
                disabled={!p.available}
                onChange={() => handleActivate(p.type)}
              />
              <span className={
                activeProvider === p.type
                  ? "text-[var(--text-color)] font-medium"
                  : "text-[var(--text-secondary)]"
              }>
                {p.name}
              </span>
              <span
                className={`ml-auto text-xs ${
                  p.available
                    ? "text-[var(--success-color)]"
                    : "text-[var(--text-tertiary)]"
                }`}
              >
                {p.available ? t("integrations.aiProviders.available") : t("integrations.aiProviders.notFound")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* REST providers */}
      <div className="mt-3 pt-3 border-t border-[var(--border-color)]" role="radiogroup" aria-label={t("integrations.aiProviders.restProviders")}>
        <div className="text-xs text-[var(--text-tertiary)] mb-2">
          {t("integrations.aiProviders.restProviders")}
        </div>
        {restProviders.map((p) => {
          const isActive = activeProvider === p.type;
          return (
            <div key={p.type} className="mb-3">
              <div
                className="flex items-center gap-2 text-xs py-1 cursor-pointer"
                onClick={() => handleActivate(p.type)}
              >
                <ProviderRadio
                  checked={isActive}
                  onChange={() => handleActivate(p.type)}
                />
                <span className={
                  isActive
                    ? "text-[var(--text-color)] font-medium"
                    : "text-[var(--text-secondary)]"
                }>
                  {p.name}
                </span>
              </div>
              {isActive && (
                <RestProviderConfigFields
                  type={p.type}
                  endpoint={p.endpoint}
                  apiKey={p.apiKey}
                  model={p.model}
                />
              )}
            </div>
          );
        })}
      </div>
    </SettingsGroup>
  );
}

