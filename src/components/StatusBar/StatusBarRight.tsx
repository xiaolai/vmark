/**
 * StatusBarRight
 *
 * Purpose: Right-hand section of the status bar — word/char count, lint badge,
 * AI status indicator (running/error/success), MCP connection status, terminal
 * toggle, and editor mode toggle. Rare states (update lifecycle, auto-save
 * paused, divergent) are TOASTS since WI-UB3 — see hooks/useStatusToasts.
 *
 * Key decisions:
 *   - Split from StatusBar.tsx to isolate re-renders: props like wordCount
 *     change frequently, but the left-side tab strip should not re-render.
 *   - Mode toggle flushes any pending WYSIWYG content before switching
 *     to Source mode, preventing content loss from debounced serialization.
 *   - MCP tooltip is built from live client list (connected AI tools)
 *     and clicking opens the integrations settings panel.
 *   - formatClientName handles acronym capitalization (CLI, AI, MCP, etc.).
 *   - AI status indicators are role="status" aria-live="polite" so screen
 *     readers hear AI start/error/done. Running's per-second elapsed text
 *     is aria-hidden with a static sr-only sibling carrying the
 *     announcement, so the live region content stays stable across ticks
 *     and SR users aren't spammed every second.
 *
 * @coordinates-with StatusBar.tsx — parent passes all props
 * @coordinates-with hooks/useStatusToasts.ts — rare states toast instead (WI-UB3)
 * @module components/StatusBar/StatusBarRight
 */
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Code2, Lock, LockOpen, Satellite, Save, Terminal, Type } from "lucide-react";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { requestToggleTerminal } from "@/services/terminal/terminalGate";
import { formatExactTime } from "@/utils/dateUtils";
import { formatKeyForDisplay } from "@/stores/settingsStore";
import { ICON_SM } from "@/utils/iconSizes";
import { StatusBarCounts } from "./StatusBarCounts";
import { StatusBarAiIndicator } from "./StatusBarAiIndicator";
import { McpHistoryButton } from "@/components/McpHistory";
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
  /** Suppresses the saved-time chip; the paused TOAST carries the story. */
  showAutoSavePaused: boolean;
  /** Suppresses the saved-time chip; the divergent TOAST carries the story. */
  isDivergent: boolean;
  showAutoSave: boolean;
  lastAutoSave: number | null;
  autoSaveTime: string;
  terminalVisible: boolean;
  terminalShortcut: string;
  sourceMode: boolean;
  sourceModeShortcut: string;
  onToggleSourceMode: () => void;
  /**
   * Hide the WYSIWYG↔Source toggle entirely. Used for YAML workflow
   * tabs where the markdown round-trip would corrupt the file.
   */
  modeToggleHidden?: boolean;
  readOnly: boolean;
  readOnlyShortcut: string;
  onToggleReadOnly: () => void;
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
  sourceMode,
  sourceModeShortcut,
  onToggleSourceMode,
  modeToggleHidden,
  readOnly,
  readOnlyShortcut,
  onToggleReadOnly,
}: StatusBarRightProps) {
  const { t } = useTranslation("statusbar");
  return (
    <div className="status-bar-right">
      {/* Auto-save-paused and divergent are TOASTS now (WI-UB3,
          useStatusToasts) — the props survive only to suppress a stale
          "saved Xs ago" chip while either state is telling a truer story. */}
      {showAutoSave && lastAutoSave && !showAutoSavePaused && !isDivergent && (
        <span className="status-autosave" title={t("autoSavedAt", { time: formatExactTime(lastAutoSave) })}>
          <Save size={ICON_SM} />
          {autoSaveTime}
        </span>
      )}

      <StatusBarCounts />

      <LintBadge />

      {/* WI-UA11 (audit 20260901): hairline dividers split the cluster into
          role groups — document signals | connectivity | editor state. */}
      <span className="status-bar-divider" aria-hidden="true" />

      <StatusBarAiIndicator
        aiRunning={aiRunning}
        elapsedSeconds={elapsedSeconds}
        aiError={aiError}
        showSuccess={showSuccess}
        onCancelAi={onCancelAi}
        onRetryAi={onRetryAi}
        onDismissError={onDismissError}
      />

      <button
        className={`status-mcp ${mcpRunning ? "connected" : ""} ${mcpLoading ? "loading" : ""} ${mcpError ? "error" : ""}`}
        onClick={openMcpSettings}
        title={formatMcpTooltip(mcpRunning, mcpLoading, mcpError, mcpClients)}
        // R13 (WI-UI4.5): the STATE rides in the accessible name, not colour.
        aria-label={formatMcpTooltip(mcpRunning, mcpLoading, mcpError, mcpClients)}
      >
        <Satellite size={ICON_SM} />
        {/* Second channel beside colour: a state WORD (WI-UA10) — the old
            ✓/⟳/✗/○ glyph set was cryptic without its tooltip. */}
        <span className="status-mcp__state" aria-hidden="true">
          {mcpError ? t("mcpStateError") : mcpLoading ? t("mcpStateStarting") : mcpRunning ? t("mcpStateOn") : t("mcpStateOff")}
        </span>
      </button>

      <McpHistoryButton />

      <span className="status-bar-divider" aria-hidden="true" />

      <button
        className={`status-terminal ${terminalVisible ? "active" : ""}`}
        title={t("toggleTerminal", { shortcut: formatKeyForDisplay(terminalShortcut) })}
        aria-label={t("toggleTerminal", { shortcut: formatKeyForDisplay(terminalShortcut) })}
        aria-expanded={terminalVisible}
        onClick={() => requestToggleTerminal()}
      >
        <Terminal size={ICON_SM} />
      </button>

      {!modeToggleHidden && (
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
          {sourceMode ? <Code2 size={ICON_SM} /> : <Type size={ICON_SM} />}
        </button>
      )}

      <button
        className={`status-lock${readOnly ? " active" : ""}`}
        title={readOnly ? t("readOnlyTitle", { shortcut: formatKeyForDisplay(readOnlyShortcut) }) : t("editableTitle", { shortcut: formatKeyForDisplay(readOnlyShortcut) })}
        aria-label={readOnly ? t("readOnly") : t("editable")}
        aria-pressed={readOnly}
        onClick={onToggleReadOnly}
      >
        {readOnly ? <Lock size={ICON_SM} /> : <LockOpen size={ICON_SM} />}
      </button>
    </div>
  );
}
