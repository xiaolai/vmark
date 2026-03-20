/**
 * MCP Config Preview Dialog Component
 *
 * Shows preview of config changes before installation.
 */

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button, CloseButton, CopyButton } from "./components";

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
      } else if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === dialog) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
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
  // Shorten home paths: macOS /Users/x, Windows C:/Users/x, Linux /home/x → ~
  const shortenHome = (p: string) =>
    p.replace(/^\/Users\/[^/]+/, "~")
      .replace(/^[A-Za-z]:\/Users\/[^/]+/, "~")
      .replace(/^\/home\/[^/]+/, "~");
  const shortPath = shortenHome(preview.path);
  const shortBinaryPath = shortenHome(preview.binaryPath);
  const shortBackupPath = shortenHome(preview.backupPath);

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-content z-[1000]"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="MCP Config Preview"
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
          <CloseButton onClick={onCancel} />
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
          <Button onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={loading}>
            {loading ? "Installing..." : "Install"}
          </Button>
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
      {copyable && <CopyButton text={fullValue || value} />}
      {badge && (
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            badgeColor === "amber"
              ? "bg-[var(--warning-bg)] text-[var(--warning-color)]"
              : "bg-[var(--success-color)]/10 text-[var(--success-color)]"
          }`}
        >
          {badge}
        </span>
      )}
    </div>
  );
}
