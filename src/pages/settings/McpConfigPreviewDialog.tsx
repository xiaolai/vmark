/**
 * MCP Config Preview Dialog Component
 *
 * Shows preview of config changes before installation.
 */

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ConfigPreview {
  provider: string;
  path: string;
  binaryPath: string;
  isDev: boolean;
  currentContent: string | null;
  proposedContent: string;
  backupPath: string;
}

interface McpConfigPreviewDialogProps {
  preview: ConfigPreview;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

const PROVIDER_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
};

export function McpConfigPreviewDialog({
  preview,
  onConfirm,
  onCancel,
  loading,
}: McpConfigPreviewDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && !loading) {
        e.preventDefault();
        onConfirm();
      }
    },
    [onCancel, onConfirm, loading]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Focus trap
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const providerName = PROVIDER_NAMES[preview.provider] || preview.provider;
  const shortPath = preview.path.replace(/^\/Users\/[^/]+/, "~");
  const shortBinaryPath = preview.binaryPath.replace(/^\/Users\/[^/]+/, "~");
  const shortBackupPath = preview.backupPath.replace(/^\/Users\/[^/]+/, "~");

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-content z-[1000]"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="mx-auto bg-[var(--bg-primary)] border border-[var(--border-color)]
                   rounded-lg shadow-lg w-[560px] max-w-[90vw] max-h-[80vh]
                   flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Install MCP Config for {providerName}
          </h3>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-[var(--hover-bg)] text-[var(--text-tertiary)]"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Config Info */}
          <div className="space-y-2">
            <InfoRow label="Config File" value={shortPath} mono />
            <InfoRow
              label="Binary Path"
              value={shortBinaryPath}
              fullValue={preview.binaryPath}
              mono
              copyable
              badge={preview.isDev ? "Development" : undefined}
              badgeColor={preview.isDev ? "amber" : undefined}
            />
            {preview.currentContent && (
              <InfoRow label="Backup" value={shortBackupPath} mono />
            )}
          </div>

          {/* Proposed Content */}
          <div>
            <div className="text-xs font-medium text-[var(--text-primary)] mb-1.5">
              Proposed Configuration
            </div>
            <pre className="p-3 bg-[var(--bg-tertiary)] rounded-md text-xs font-mono
                           text-[var(--text-primary)] overflow-auto max-h-48 whitespace-pre">
              {preview.proposedContent}
            </pre>
          </div>

          {/* Current Content (if exists) */}
          {preview.currentContent && (
            <div>
              <div className="text-xs font-medium text-[var(--text-primary)] mb-1.5">
                Current Configuration
              </div>
              <pre className="p-3 bg-[var(--bg-tertiary)] rounded-md text-xs font-mono
                             text-[var(--text-tertiary)] overflow-auto max-h-32 whitespace-pre">
                {preview.currentContent}
              </pre>
            </div>
          )}

          {/* Safety Note */}
          <div className="text-xs text-[var(--text-tertiary)] flex items-start gap-2">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>
              {preview.currentContent
                ? "A backup will be created before modifying the existing configuration."
                : "A new configuration file will be created."}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border-color)]">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-3 py-1.5 text-sm font-medium rounded border
                      border-[var(--border-color)] bg-transparent
                      text-[var(--text-primary)] hover:bg-[var(--hover-bg)]
                      disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-3 py-1.5 text-sm font-medium rounded
                      bg-[var(--accent-primary)] text-white hover:opacity-90
                      disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Installing..." : "Install"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function InfoRow({
  label,
  value,
  mono,
  badge,
  badgeColor,
  copyable,
  fullValue,
}: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: string;
  badgeColor?: "green" | "amber";
  copyable?: boolean;
  fullValue?: string; // Full value to copy (if different from displayed value)
}) {
  const handleCopy = () => {
    navigator.clipboard.writeText(fullValue || value);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--text-tertiary)] w-20 flex-shrink-0">
        {label}
      </span>
      <span
        className={`text-xs text-[var(--text-primary)] truncate ${
          mono ? "font-mono" : ""
        }`}
        title={fullValue || value}
      >
        {value}
      </span>
      {copyable && (
        <button
          onClick={handleCopy}
          className="p-0.5 rounded hover:bg-[var(--hover-bg)] text-[var(--text-tertiary)]
                     hover:text-[var(--text-secondary)] transition-colors"
          title="Copy to clipboard"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      )}
      {badge && (
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            badgeColor === "amber"
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          }`}
        >
          {badge}
        </span>
      )}
    </div>
  );
}
