/**
 * Diagnostic status icon for the MCP config installer. Extracted from
 * McpConfigInstaller to keep that file under its size baseline (audit
 * 20260612 gate).
 */

export type DiagnosticStatus =
  | "Valid"
  | "PathMismatch"
  | "BinaryMissing"
  | "NotConfigured";

export function DiagnosticIcon({ status }: { status: DiagnosticStatus }) {
  switch (status) {
    case "Valid":
      return (
        <span className="w-4 h-4 text-[var(--success-color)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      );
    case "PathMismatch":
      return (
        <span className="w-4 h-4 text-[var(--warning-color)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>
      );
    case "BinaryMissing":
      return (
        <span className="w-4 h-4 text-[var(--error-color)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </span>
      );
    case "NotConfigured":
    default:
      return (
        <span className="w-4 h-4 text-[var(--text-tertiary)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
          </svg>
        </span>
      );
  }
}
