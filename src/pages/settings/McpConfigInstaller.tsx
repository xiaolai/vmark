/**
 * MCP Configuration Installer Component
 *
 * UI for installing MCP configuration to AI providers.
 * Shows diagnostics including path validation status.
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { SettingsGroup, Button, CopyButton } from "./components";
import { McpConfigPreviewDialog } from "./McpConfigPreviewDialog";
import { CcSwitchImportRow } from "./CcSwitchImportRow";
import { getFileName } from "@/utils/paths";
import { DiagnosticIcon } from "./DiagnosticIcon";
import {
  diagnosticMessage,
  formatPath,
  installMessage,
  rowActions,
  uninstallMessage,
  type InstallResult,
  type ProviderDiagnostic,
  type UninstallResult,
} from "./mcpConfigMessages";

interface ConfigPreview {
  provider: string;
  path: string;
  binaryPath: string;
  isDev: boolean;
  currentContent: string | null;
  proposedContent: string;
  backupPath: string;
}

/** Shorten path to just filename for display */
function shortenPath(path: string): string {
  return getFileName(path) || path;
}

interface ProviderRowProps {
  diagnostic: ProviderDiagnostic;
  onPreview: () => void;
  onRepair: () => void;
  onUninstall: () => void;
  onRecheck: () => void;
  loading: boolean;
}

function ProviderRow(props: ProviderRowProps) {
  const { diagnostic, onPreview, onRepair, onUninstall, onRecheck, loading } = props;
  const { t } = useTranslation("settings");
  const actions = rowActions(diagnostic);
  const broken = diagnostic.status === "ConfigUnreadable";

  const diagnosticText = diagnosticMessage(diagnostic, t);

  return (
    <div className="flex flex-col py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <DiagnosticIcon status={diagnostic.status} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[var(--text-color)] truncate">
              {diagnostic.name}
            </div>
            <div className="flex items-center gap-1">
              <span
                className="text-xs text-[var(--text-tertiary)] font-mono truncate"
                title={formatPath(diagnostic.configPath)}
              >
                {shortenPath(diagnostic.configPath)}
              </span>
              <CopyButton text={diagnostic.configPath} size="xs" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-3">
          {actions.repair && (
            <Button size="sm" variant="warning" onClick={onRepair} disabled={loading}>
              {t("integrations.installMcp.repair")}
            </Button>
          )}
          {actions.update && (
            <Button size="sm" onClick={onPreview} disabled={loading}>
              {t("integrations.installMcp.update")}
            </Button>
          )}
          {actions.remove && (
            <Button size="sm" variant="danger" onClick={onUninstall} disabled={loading}>
              {t("integrations.installMcp.remove")}
            </Button>
          )}
          {actions.install && (
            <Button size="sm" variant="primary" onClick={onPreview} disabled={loading}>
              {t("integrations.installMcp.install")}
            </Button>
          )}
          {actions.recheck && (
            <Button size="sm" onClick={onRecheck} disabled={loading}>
              {t("integrations.installMcp.recheck")}
            </Button>
          )}
        </div>
      </div>
      {diagnosticText && (
        <div
          className={`mt-1 ml-6.5 text-xs ${
            broken ? "text-[var(--error-color)]" : "text-[var(--warning-color)]"
          }`}
        >
          {diagnosticText}
        </div>
      )}
    </div>
  );
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
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async provider probe sets diagnostics on mount (#1063)
    loadDiagnostics();
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
      setError(String(err));
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
      setError(String(err));
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
      setError(String(err));
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
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingsGroup title={t("integrations.group.installMcp")} className="mb-0">
      <div className="text-xs text-[var(--text-tertiary)] mb-3">
        {t("integrations.installMcp.hint")}
      </div>

      <div>
        {diagnostics.map((diagnostic) => (
          <ProviderRow
            key={diagnostic.provider}
            diagnostic={diagnostic}
            onPreview={() => handlePreview(diagnostic.provider)}
            onRepair={() => handleRepair(diagnostic.provider)}
            onUninstall={() => handleUninstall(diagnostic.provider)}
            onRecheck={loadDiagnostics}
            loading={loading}
          />
        ))}
        {diagnostics.length === 0 && (
          <div className="py-4 text-center text-sm text-[var(--text-tertiary)]">
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
            <span className="text-[var(--text-tertiary)] ml-1">
              {t("integrations.installMcp.restartHint")}
            </span>
          )}
        </div>
      )}

      {preview && (
        <McpConfigPreviewDialog
          preview={preview}
          onConfirm={handleInstall}
          onCancel={() => setPreview(null)}
          loading={loading}
        />
      )}
    </SettingsGroup>
  );
}
