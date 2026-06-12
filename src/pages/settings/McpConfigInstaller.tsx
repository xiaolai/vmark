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
import { getFileName, normalizePath } from "@/utils/paths";
import { DiagnosticIcon, type DiagnosticStatus } from "./DiagnosticIcon";

interface ProviderDiagnostic {
  provider: string;
  name: string;
  configPath: string;
  configExists: boolean;
  hasVmark: boolean;
  expectedBinaryPath: string | null;
  configuredBinaryPath: string | null;
  binaryExists: boolean;
  status: DiagnosticStatus;
  message: string;
}

interface ConfigPreview {
  provider: string;
  path: string;
  binaryPath: string;
  isDev: boolean;
  currentContent: string | null;
  proposedContent: string;
  backupPath: string;
}

interface InstallResult {
  success: boolean;
  message: string;
  backupPath: string | null;
}

interface UninstallResult {
  success: boolean;
  message: string;
}

/** Shorten path to just filename for display */
function shortenPath(path: string): string {
  return getFileName(path) || path;
}

/** Format path for tooltip (replace home with ~) */
function formatPath(path: string): string {
  const normalized = normalizePath(path);
  // Shorten home paths: macOS /Users/x, Windows C:/Users/x, Linux /home/x → ~
  return normalized
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^[A-Za-z]:\/Users\/[^/]+/, "~")
    .replace(/^\/home\/[^/]+/, "~");
}

interface ProviderRowProps {
  diagnostic: ProviderDiagnostic;
  onPreview: () => void;
  onRepair: () => void;
  onUninstall: () => void;
  loading: boolean;
}

function ProviderRow({ diagnostic, onPreview, onRepair, onUninstall, loading }: ProviderRowProps) {
  const { t } = useTranslation("settings");
  const showRepairButton = diagnostic.status === "PathMismatch";
  const showUpdateRemove = diagnostic.hasVmark && diagnostic.status !== "PathMismatch";
  const showInstall = !diagnostic.hasVmark;

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
          {showRepairButton && (
            <>
              <Button size="sm" variant="warning" onClick={onRepair} disabled={loading}>
                {t("integrations.installMcp.repair")}
              </Button>
              <Button size="sm" onClick={onPreview} disabled={loading}>
                {t("integrations.installMcp.update")}
              </Button>
              <Button size="sm" variant="danger" onClick={onUninstall} disabled={loading}>
                {t("integrations.installMcp.remove")}
              </Button>
            </>
          )}
          {showUpdateRemove && (
            <>
              <Button size="sm" onClick={onPreview} disabled={loading}>
                {t("integrations.installMcp.update")}
              </Button>
              <Button size="sm" variant="danger" onClick={onUninstall} disabled={loading}>
                {t("integrations.installMcp.remove")}
              </Button>
            </>
          )}
          {showInstall && (
            <Button size="sm" variant="primary" onClick={onPreview} disabled={loading}>
              {t("integrations.installMcp.install")}
            </Button>
          )}
        </div>
      </div>
      {diagnostic.message && (
        <div className="mt-1 ml-6.5 text-xs text-[var(--warning-color)]">
          {diagnostic.message}
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
        setSuccessMessage(result.message);
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

  // CC-Switch deep-link import (issue #1008). VMark's sidecar binary path is
  // the same across providers; grab the first diagnostic that resolved it.
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
        setSuccessMessage(result.message);
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
