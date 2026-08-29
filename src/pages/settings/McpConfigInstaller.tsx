/**
 * MCP Configuration Installer Component
 *
 * UI for installing MCP configuration to AI providers.
 * Shows diagnostics including path validation status.
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "./components";
import { McpConfigPreviewDialog } from "./McpConfigPreviewDialog";
import { CcSwitchImportRow } from "./CcSwitchImportRow";
import { ProviderRow } from "./McpProviderRow";
import {
  installMessage,
  uninstallMessage,
  type InstallResult,
  type ProviderDiagnostic,
  type UninstallResult,
} from "./mcpConfigMessages";
import { commandErrorMessage } from "@/services/commands/commandError";

interface ConfigPreview {
  provider: string;
  path: string;
  binaryPath: string;
  isDev: boolean;
  currentContent: string | null;
  proposedContent: string;
  backupPath: string;
}

interface McpConfigInstallerProps {
  /** Called after successful install - used to enable autoStart and start bridge */
  onInstallSuccess?: () => void;
}

export function McpConfigInstaller({ onInstallSuccess }: McpConfigInstallerProps) {
  const { t } = useTranslation("settings");
  const [diagnostics, setDiagnostics] = useState<ProviderDiagnostic[]>([]);
  const [preview, setPreview] = useState<ConfigPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showRestartHint, setShowRestartHint] = useState(false);

  const loadDiagnostics = useCallback(async () => {
    try {
      const results = await invoke<ProviderDiagnostic[]>("mcp_config_diagnose");
      setDiagnostics(results);
      setError(null);
    } catch (err) {
      setError(commandErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async provider probe sets diagnostics on mount (#1063)
    void loadDiagnostics();
  }, [loadDiagnostics]);

  const handlePreview = async (providerId: string) => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setShowRestartHint(false);
    try {
      const previewData = await invoke<ConfigPreview>("mcp_config_preview", {
        provider: providerId,
      });
      setPreview(previewData);
    } catch (err) {
      setError(commandErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async () => {
    if (!preview) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<InstallResult>("mcp_config_install", {
        provider: preview.provider,
      });
      if (result.success) {
        setSuccessMessage(installMessage(preview.provider, t));
        setShowRestartHint(true);
        setPreview(null);
        await loadDiagnostics();
        // Enable autoStart and start bridge after successful install
        onInstallSuccess?.();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(commandErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRepair = async (providerId: string) => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setShowRestartHint(false);
    try {
      const result = await invoke<InstallResult>("mcp_config_install", {
        provider: providerId,
      });
      if (result.success) {
        setSuccessMessage(t("integrations.installMcp.repairSuccess"));
        setShowRestartHint(true);
        await loadDiagnostics();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(commandErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // CC-Switch deep-link import (#1008): sidecar path is identical across providers — grab the first resolved diagnostic.
  const ccSwitchBinaryPath =
    diagnostics.find((d) => d.expectedBinaryPath)?.expectedBinaryPath ?? null;

  const handleUninstall = async (providerId: string) => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setShowRestartHint(false);
    try {
      const result = await invoke<UninstallResult>("mcp_config_uninstall", {
        provider: providerId,
      });
      if (result.success) {
        setSuccessMessage(uninstallMessage(result.changed, t));
        await loadDiagnostics();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(commandErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingsGroup title={t("integrations.group.installMcp")} className="mb-0">
      <div className="text-xs text-[var(--text-secondary)] mb-3">
        {t("integrations.installMcp.hint")}
      </div>

      <div>
        {diagnostics.map((diagnostic) => (
          <ProviderRow
            key={diagnostic.provider}
            diagnostic={diagnostic}
            onPreview={() => void handlePreview(diagnostic.provider)}
            onRepair={() => void handleRepair(diagnostic.provider)}
            onUninstall={() => void handleUninstall(diagnostic.provider)}
            onRecheck={() => void loadDiagnostics()}
            loading={loading}
          />
        ))}
        {diagnostics.length === 0 && (
          <div className="py-4 text-center text-sm text-[var(--text-secondary)]">
            {t("integrations.installMcp.loadingProviders")}
          </div>
        )}

        {/* CC-Switch deep-link import (issue #1008) — one-click hand-off to
            the CC-Switch config manager, which syncs the entry into the AI
            CLIs the user manages there. */}
        {diagnostics.length > 0 && (
          <CcSwitchImportRow binaryPath={ccSwitchBinaryPath} loading={loading} />
        )}
      </div>

      {error && (
        <div className="mt-2 text-xs text-[var(--error-color)]">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="mt-2 text-xs text-[var(--success-color)]">
          {successMessage}
          {showRestartHint && (
            <span className="text-[var(--text-secondary)] ml-1">
              {t("integrations.installMcp.restartHint")}
            </span>
          )}
        </div>
      )}

      {preview && (
        <McpConfigPreviewDialog
          preview={preview}
          onConfirm={() => void handleInstall()}
          onCancel={() => setPreview(null)}
          loading={loading}
        />
      )}
    </SettingsGroup>
  );
}
