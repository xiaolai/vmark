import { AlertTriangle, Code2, GitFork, Satellite, Save, Sparkles, Terminal, Type } from "lucide-react";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import { requestToggleTerminal } from "@/components/Terminal/terminalGate";
import { formatExactTime } from "@/utils/dateUtils";
import { formatKeyForDisplay } from "@/stores/shortcutsStore";
import { UpdateIndicator } from "./UpdateIndicator";

interface StatusBarRightProps {
  aiRunning: boolean;
  mcpRunning: boolean;
  mcpLoading: boolean;
  mcpPort: number | null;
  mcpError: string | null;
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
  mcpPort,
  mcpError,
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
        title={
          mcpError
            ? `MCP error: ${mcpError}`
            : mcpLoading
              ? "MCP starting..."
              : mcpRunning
                ? `MCP running on port ${mcpPort}`
                : "MCP stopped · Click to configure"
        }
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
