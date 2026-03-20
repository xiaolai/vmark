/**
 * StatusBarRight
 *
 * Purpose: Right-hand section of the status bar — word/char count, update indicator,
 * auto-save/divergent/missing warnings, AI status indicator (running/error/success),
 * MCP connection status, terminal toggle, and editor mode toggle.
 *
 * Key decisions:
 *   - Split from StatusBar.tsx to isolate re-renders: props like wordCount
 *     change frequently, but the left-side tab strip should not re-render.
 *   - Mode toggle flushes any pending WYSIWYG content before switching
 *     to Source mode, preventing content loss from debounced serialization.
 *   - MCP tooltip is built from live client list (connected AI tools)
 *     and clicking opens the integrations settings panel.
 *   - formatClientName handles acronym capitalization (CLI, AI, MCP, etc.).
 *
 * @coordinates-with StatusBar.tsx — parent passes all props
 * @coordinates-with UpdateIndicator.tsx — inline update badge
 * @module components/StatusBar/StatusBarRight
 */
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { AlertTriangle, Check, Code2, GitFork, Satellite, Save, Sparkles, Terminal, Type } from "lucide-react";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { requestToggleTerminal } from "@/components/Terminal/terminalGate";
import { formatExactTime } from "@/utils/dateUtils";
import { formatKeyForDisplay } from "@/stores/shortcutsStore";
import { UpdateIndicator } from "./UpdateIndicator";
import { StatusBarCounts } from "./StatusBarCounts";
import { LintBadge } from "./LintBadge";
import type { McpClient } from "@/hooks/useMcpClients";

const UPPERCASE_WORDS = new Set(["cli", "ai", "mcp", "api", "ide"]);

/** "claude-code" → "Claude Code", "codex-cli" → "Codex CLI" */
export function formatClientName(name: string): string {
  return name
    .split("-")
    .map((word) =>
      UPPERCASE_WORDS.has(word)
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

function formatClientLabel(client: McpClient): string {
  const display = formatClientName(client.name);
  return client.version ? `${display} v${client.version}` : display;
}

/** Build a tooltip string for the MCP status indicator based on server and client state. */
export function formatMcpTooltip(
  running: boolean,
  loading: boolean,
  error: string | null,
  clients: McpClient[]
): string {
  if (error) return i18n.t("statusbar:mcpError", { error });
  if (loading) return i18n.t("statusbar:mcpStarting");
  if (!running) return i18n.t("statusbar:mcpStopped");

  if (clients.length === 0) return i18n.t("statusbar:mcpNoClients");
  return i18n.t("statusbar:mcpConnected", { clients: clients.map(formatClientLabel).join(", ") });
}

interface StatusBarRightProps {
  aiRunning: boolean;
  elapsedSeconds: number;
  aiError: string | null;
  showSuccess: boolean;
  onCancelAi: () => void;
  onRetryAi: () => void;
  onDismissError: () => void;
  mcpRunning: boolean;
  mcpLoading: boolean;
  mcpError: string | null;
  mcpClients: McpClient[];
  openMcpSettings: () => void;
  showAutoSavePaused: boolean;
  isDivergent: boolean;
  showAutoSave: boolean;
  lastAutoSave: number | null;
  autoSaveTime: string;
  terminalVisible: boolean;
  terminalShortcut: string;
  saveShortcut: string;
  sourceMode: boolean;
  sourceModeShortcut: string;
  onToggleSourceMode: () => void;
}

/** Right-hand section of the status bar with counts, AI/MCP status, terminal toggle, and mode toggle. */
export function StatusBarRight({
  aiRunning,
  elapsedSeconds,
  aiError,
  showSuccess,
  onCancelAi,
  onRetryAi,
  onDismissError,
  mcpRunning,
  mcpLoading,
  mcpError,
  mcpClients,
  openMcpSettings,
  showAutoSavePaused,
  isDivergent,
  showAutoSave,
  lastAutoSave,
  autoSaveTime,
  terminalVisible,
  terminalShortcut,
  saveShortcut,
  sourceMode,
  sourceModeShortcut,
  onToggleSourceMode,
}: StatusBarRightProps) {
  const { t } = useTranslation("statusbar");
  return (
    <div className="status-bar-right">
      {showAutoSavePaused && (
        <span
          className="status-autosave-paused"
          title={t("autoSavePausedTitle", { shortcut: formatKeyForDisplay(saveShortcut) })}
        >
          <AlertTriangle size={12} />
          {t("autoSavePaused")}
        </span>
      )}

      {isDivergent && !showAutoSavePaused && (
        <span
          className="status-divergent"
          title={t("divergentTitle", { shortcut: formatKeyForDisplay(saveShortcut) })}
        >
          <GitFork size={12} />
          {t("divergent")}
        </span>
      )}

      {showAutoSave && lastAutoSave && !showAutoSavePaused && !isDivergent && (
        <span className="status-autosave" title={t("autoSavedAt", { time: formatExactTime(lastAutoSave) })}>
          <Save size={12} />
          {autoSaveTime}
        </span>
      )}

      <StatusBarCounts />

      <LintBadge />

      <UpdateIndicator />

      {aiRunning && (
        <span className="status-ai-indicator status-ai-indicator--running" title={t("aiWorking")}>
          <Sparkles size={12} className="status-ai-spinner" />
          <span className="status-ai-text">
            {elapsedSeconds < 10
              ? t("aiThinking", { seconds: elapsedSeconds })
              : t("aiStillWorking", { seconds: elapsedSeconds })}
          </span>
          <button
            className="status-ai-cancel"
            onClick={onCancelAi}
            title={t("cancelAiTitle")}
            aria-label={t("cancelAiRequest")}
          >
            ×
          </button>
        </span>
      )}

      {!aiRunning && aiError && (
        <span className="status-ai-indicator status-ai-indicator--error" title={aiError}>
          <AlertTriangle size={12} />
          <span className="status-ai-text">
            {aiError.length > 30 ? `${aiError.slice(0, 30)}...` : aiError}
          </span>
          <button className="status-ai-action" onClick={onRetryAi}>{t("aiRetry")}</button>
          <button
            className="status-ai-cancel"
            onClick={onDismissError}
            title={t("dismissTitle")}
            aria-label={t("dismissError")}
          >
            ×
          </button>
        </span>
      )}

      {!aiRunning && !aiError && showSuccess && (
        <span className="status-ai-indicator status-ai-indicator--success">
          <Check size={12} />
          <span className="status-ai-text">{t("aiDone")}</span>
        </span>
      )}

      <button
        className={`status-mcp ${mcpRunning ? "connected" : ""} ${mcpLoading ? "loading" : ""} ${mcpError ? "error" : ""}`}
        onClick={openMcpSettings}
        title={formatMcpTooltip(mcpRunning, mcpLoading, mcpError, mcpClients)}
        aria-label={t("mcpStatus")}
      >
        <Satellite size={12} />
      </button>

      <button
        className={`status-terminal ${terminalVisible ? "active" : ""}`}
        title={t("toggleTerminal", { shortcut: formatKeyForDisplay(terminalShortcut) })}
        aria-label={t("toggleTerminal", { shortcut: formatKeyForDisplay(terminalShortcut) })}
        aria-expanded={terminalVisible}
        onClick={() => requestToggleTerminal()}
      >
        <Terminal size={12} />
      </button>

      <button
        className="status-mode"
        title={sourceMode ? t("sourceModeTitle", { shortcut: formatKeyForDisplay(sourceModeShortcut) }) : t("richTextModeTitle", { shortcut: formatKeyForDisplay(sourceModeShortcut) })}
        aria-label={sourceMode ? t("sourceModeTitle", { shortcut: formatKeyForDisplay(sourceModeShortcut) }) : t("richTextModeTitle", { shortcut: formatKeyForDisplay(sourceModeShortcut) })}
        onClick={() => {
          const toastStore = useImagePasteToastStore.getState();
          /* v8 ignore next -- @preserve toastStore.isOpen true branch: toast not open during mode toggle tests */
          if (toastStore.isOpen) {
            toastStore.hideToast();
          }
          flushActiveWysiwygNow();
          onToggleSourceMode();
        }}
      >
        {sourceMode ? <Code2 size={14} /> : <Type size={12} />}
      </button>
    </div>
  );
}
