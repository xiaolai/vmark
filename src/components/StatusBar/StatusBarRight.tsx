/**
 * StatusBarRight
 *
 * Purpose: Right-hand section of the status bar — word/char count, AI spinner,
 * MCP connection status, update indicator, auto-save/divergent/missing warnings,
 * terminal toggle, and editor mode toggle.
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
import { AlertTriangle, Code2, GitFork, Satellite, Save, Sparkles, Terminal, Type } from "lucide-react";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { requestToggleTerminal } from "@/components/Terminal/terminalGate";
import { formatExactTime } from "@/utils/dateUtils";
import { formatKeyForDisplay } from "@/stores/shortcutsStore";
import { UpdateIndicator } from "./UpdateIndicator";
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

export function formatMcpTooltip(
  running: boolean,
  loading: boolean,
  error: string | null,
  clients: McpClient[]
): string {
  if (error) return `MCP error: ${error}`;
  if (loading) return "MCP starting...";
  if (!running) return "MCP stopped · Click to start";

  if (clients.length === 0) return "MCP ready · No AI connected";
  return `Connected: ${clients.map(formatClientLabel).join(", ")}`;
}

interface StatusBarRightProps {
  aiRunning: boolean;
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
  wordCount: number;
  charCount: number;
  terminalVisible: boolean;
  terminalShortcut: string;
  sourceMode: boolean;
  sourceModeShortcut: string;
  onToggleSourceMode: () => void;
}

export function StatusBarRight({
  aiRunning,
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
  wordCount,
  charCount,
  terminalVisible,
  terminalShortcut,
  sourceMode,
  sourceModeShortcut,
  onToggleSourceMode,
}: StatusBarRightProps) {
  return (
    <div className="status-bar-right">
      <span className="status-item">{wordCount} words</span>
      <span className="status-item">{charCount} chars</span>

      {aiRunning && (
        <span className="status-ai-running" title="AI genie is working...">
          <Sparkles size={12} />
        </span>
      )}

      <button
        className={`status-mcp ${mcpRunning ? "connected" : ""} ${mcpLoading ? "loading" : ""} ${mcpError ? "error" : ""}`}
        onClick={openMcpSettings}
        title={formatMcpTooltip(mcpRunning, mcpLoading, mcpError, mcpClients)}
      >
        <Satellite size={12} />
      </button>

      <UpdateIndicator />

      {showAutoSavePaused && (
        <span
          className="status-autosave-paused"
          title="Auto-save paused: file was deleted from disk. Save manually with Cmd+S."
        >
          <AlertTriangle size={12} />
          Auto-save paused
        </span>
      )}

      {isDivergent && !showAutoSavePaused && (
        <span
          className="status-divergent"
          title="Local differs from disk. Save (Cmd+S) to sync, or use File > Revert to discard local changes."
        >
          <GitFork size={12} />
          Divergent
        </span>
      )}

      {showAutoSave && lastAutoSave && !showAutoSavePaused && !isDivergent && (
        <span className="status-autosave" title={`Auto-saved at ${formatExactTime(lastAutoSave)}`}>
          <Save size={12} />
          {autoSaveTime}
        </span>
      )}

      <button
        className={`status-terminal ${terminalVisible ? "active" : ""}`}
        title={`Toggle Terminal (${formatKeyForDisplay(terminalShortcut)})`}
        onClick={() => requestToggleTerminal()}
      >
        <Terminal size={12} />
      </button>

      <button
        className="status-mode"
        title={sourceMode ? `Source Mode (${formatKeyForDisplay(sourceModeShortcut)})` : `Rich Text Mode (${formatKeyForDisplay(sourceModeShortcut)})`}
        onClick={() => {
          const toastStore = useImagePasteToastStore.getState();
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
