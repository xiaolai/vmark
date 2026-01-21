/**
 * MCP Configuration Installer Component
 *
 * UI for installing MCP configuration to AI providers.
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingsGroup } from "./components";
import { McpConfigPreviewDialog } from "./McpConfigPreviewDialog";

interface ProviderStatus {
  provider: string;
  name: string;
  path: string;
  exists: boolean;
  hasVmark: boolean;
  configuredPort: number | null;
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

function StatusIcon({ installed }: { installed: boolean }) {
  if (installed) {
    return (
      <span className="w-4 h-4 text-green-600 dark:text-green-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  return (
    <span className="w-4 h-4 text-[var(--text-tertiary)]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
      </svg>
    </span>
  );
}

function CopyButton({ text, size = "sm" }: { text: string; size?: "sm" | "xs" }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-3 h-3";

  return (
    <button
      onClick={handleCopy}
      className="p-0.5 rounded hover:bg-[var(--hover-bg)] text-[var(--text-tertiary)]
                hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
      title={copied ? "Copied!" : "Copy path"}
    >
      {copied ? (
        <svg className={`${iconSize} text-green-500`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg className={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

/** Shorten path to just filename for display */
function shortenPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

/** Format path for tooltip (replace home with ~) */
function formatPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

interface ProviderRowProps {
  provider: ProviderStatus;
  port: number;
  onPreview: () => void;
  onUninstall: () => void;
  loading: boolean;
}

function ProviderRow({ provider, port, onPreview, onUninstall, loading }: ProviderRowProps) {
  const needsUpdate = provider.hasVmark && provider.configuredPort !== port;

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-200 dark:border-gray-700 last:border-b-0">
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <StatusIcon installed={provider.hasVmark && !needsUpdate} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--text-primary)] truncate">
            {provider.name}
          </div>
          <div className="flex items-center gap-1">
            <span
              className="text-xs text-[var(--text-tertiary)] font-mono truncate"
              title={formatPath(provider.path)}
            >
              {shortenPath(provider.path)}
            </span>
            <CopyButton text={provider.path} size="xs" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 ml-3">
        {provider.hasVmark && needsUpdate && (
          <span className="text-xs text-amber-600 dark:text-amber-400 whitespace-nowrap">
            Port mismatch
          </span>
        )}
        {provider.hasVmark ? (
          <>
            <button
              onClick={onPreview}
              disabled={loading}
              className="px-2.5 py-1 text-xs font-medium rounded border
                        border-gray-200 dark:border-gray-700 bg-transparent
                        text-[var(--text-primary)] hover:bg-[var(--hover-bg)]
                        disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Update
            </button>
            <button
              onClick={onUninstall}
              disabled={loading}
              className="px-2.5 py-1 text-xs font-medium rounded border
                        border-gray-200 dark:border-gray-700 bg-transparent
                        text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20
                        disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Remove
            </button>
          </>
        ) : (
          <button
            onClick={onPreview}
            disabled={loading}
            className="px-2.5 py-1 text-xs font-medium rounded
                      bg-[var(--accent-primary)] text-white
                      hover:opacity-90
                      disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Install
          </button>
        )}
      </div>
    </div>
  );
}

interface McpConfigInstallerProps {
  port: number;
  /** Called after successful install - used to enable autoStart and start bridge */
  onInstallSuccess?: () => void;
}

export function McpConfigInstaller({ port, onInstallSuccess }: McpConfigInstallerProps) {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [preview, setPreview] = useState<ConfigPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const statuses = await invoke<ProviderStatus[]>("mcp_config_get_status");
      setProviders(statuses);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handlePreview = async (providerId: string) => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const previewData = await invoke<ConfigPreview>("mcp_config_preview", {
        provider: providerId,
        port,
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
        port,
      });
      if (result.success) {
        setSuccessMessage(result.message);
        setPreview(null);
        await loadStatus();
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

  const handleUninstall = async (providerId: string) => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await invoke<UninstallResult>("mcp_config_uninstall", {
        provider: providerId,
      });
      if (result.success) {
        setSuccessMessage(result.message);
        await loadStatus();
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
    <SettingsGroup title="Install MCP Configuration" className="mb-0">
      <div className="text-xs text-[var(--text-tertiary)] mb-3">
        Configure AI assistants to connect to VMark MCP server.
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        {providers.map((provider) => (
          <ProviderRow
            key={provider.provider}
            provider={provider}
            port={port}
            onPreview={() => handlePreview(provider.provider)}
            onUninstall={() => handleUninstall(provider.provider)}
            loading={loading}
          />
        ))}
        {providers.length === 0 && (
          <div className="py-4 text-center text-sm text-[var(--text-tertiary)]">
            Loading providers...
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 text-xs text-red-500">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="mt-2 text-xs text-green-600 dark:text-green-400">
          {successMessage}
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
