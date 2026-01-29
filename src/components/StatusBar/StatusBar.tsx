import { useMemo, useState, useEffect, useCallback, type MouseEvent, type KeyboardEvent } from "react";

// Stable empty array to avoid creating new reference on each render
const EMPTY_TABS: never[] = [];
import { Code2, Type, Save, Plus, AlertTriangle, GitFork, Radio } from "lucide-react";
import { countWords as alfaazCount } from "alfaaz";
import { useViewSettingsStore } from "@/stores/viewSettingsStore";
import { useUIStore } from "@/stores/uiStore";
import { useWindowLabel, useIsDocumentWindow } from "@/contexts/WindowContext";
import { useTabStore, type Tab as TabType } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useImagePasteToastStore } from "@/stores/imagePasteToastStore";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import {
  useDocumentContent,
  useDocumentLastAutoSave,
  useDocumentIsMissing,
  useDocumentIsDivergent,
} from "@/hooks/useDocumentState";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatRelativeTime, formatExactTime } from "@/utils/dateUtils";
import { Tab } from "@/components/Tabs/Tab";
import { TabContextMenu, type ContextMenuPosition } from "@/components/Tabs/TabContextMenu";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/shortcutsStore";
import { useMcpServer } from "@/hooks/useMcpServer";
import { useMcpHealthStore } from "@/stores/mcpHealthStore";
import "./StatusBar.css";

/**
 * Prevent Cmd+A from selecting all page content when focus is on non-input elements.
 * Only prevents when active element is a button or similar non-text element.
 */
function preventSelectAllOnButtons(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "a") {
    const target = e.target as HTMLElement;
    if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
      e.preventDefault();
    }
  }
}

/**
 * Strip markdown formatting to get plain text for word counting.
 */
function stripMarkdown(text: string): string {
  return (
    text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]+`/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/^>\s+/gm, "")
      .replace(/^[-*_]{3,}\s*$/gm, "")
      .replace(/^[\s]*[-*+]\s+/gm, "")
      .replace(/^[\s]*\d+\.\s+/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Count words using alfaaz library (handles CJK and other languages).
 * Expects pre-stripped plain text.
 */
function countWordsFromPlain(plainText: string): number {
  return alfaazCount(plainText);
}

/**
 * Count non-whitespace characters.
 * Expects pre-stripped plain text.
 */
function countCharsFromPlain(plainText: string): number {
  return plainText.replace(/\s/g, "").length;
}

export function StatusBar() {
  const isDocumentWindow = useIsDocumentWindow();
  const windowLabel = useWindowLabel();
  const content = useDocumentContent();
  const lastAutoSave = useDocumentLastAutoSave();
  const isMissing = useDocumentIsMissing();
  const isDivergent = useDocumentIsDivergent();
  const autoSaveEnabled = useSettingsStore((s) => s.general.autoSaveEnabled);
  const sourceMode = useViewSettingsStore((state) => state.sourceMode);
  const statusBarVisible = useUIStore((state) => state.statusBarVisible);
  const sourceModeShortcut = useShortcutsStore((state) => state.getShortcut("sourceMode"));

  // MCP server status
  const { running: mcpRunning, loading: mcpLoading } = useMcpServer();
  const openMcpDialog = useMcpHealthStore((state) => state.openDialog);

  // Show warning when file is missing and auto-save is enabled
  const showAutoSavePaused = isMissing && autoSaveEnabled;

  // Tab state - only for document windows
  // Use stable EMPTY_TABS to avoid infinite loop from new array reference
  const tabs = useTabStore((state) =>
    isDocumentWindow ? state.tabs[windowLabel] ?? EMPTY_TABS : EMPTY_TABS
  );
  const activeTabId = useTabStore((state) =>
    isDocumentWindow ? state.activeTabId[windowLabel] : null
  );

  const [contextMenu, setContextMenu] = useState<{
    position: ContextMenuPosition;
    tab: TabType;
  } | null>(null);

  const [showAutoSave, setShowAutoSave] = useState(false);
  const [autoSaveTime, setAutoSaveTime] = useState<string>("");

  // Auto-save indicator effect
  useEffect(() => {
    if (!lastAutoSave) return;

    setAutoSaveTime(formatRelativeTime(lastAutoSave));
    setShowAutoSave(true);

    const updateInterval = setInterval(() => {
      setAutoSaveTime(formatRelativeTime(lastAutoSave));
    }, 10000);

    const fadeTimeout = setTimeout(() => {
      setShowAutoSave(false);
    }, 5000);

    return () => {
      clearInterval(updateInterval);
      clearTimeout(fadeTimeout);
    };
  }, [lastAutoSave]);

  // Tab handlers
  const handleActivateTab = useCallback(
    (tabId: string) => {
      useTabStore.getState().setActiveTab(windowLabel, tabId);
    },
    [windowLabel]
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      closeTabWithDirtyCheck(windowLabel, tabId);
    },
    [windowLabel]
  );

  const handleContextMenu = useCallback(
    (e: MouseEvent, tab: TabType) => {
      e.preventDefault();
      setContextMenu({
        position: { x: e.clientX, y: e.clientY },
        tab,
      });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleNewTab = useCallback(() => {
    const tabId = useTabStore.getState().createTab(windowLabel, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
  }, [windowLabel]);

  // Memoize stripped content once, then derive both counts from it
  // This avoids running the expensive stripMarkdown regex twice per keystroke
  const strippedContent = useMemo(() => stripMarkdown(content), [content]);
  const wordCount = useMemo(() => countWordsFromPlain(strippedContent), [strippedContent]);
  const charCount = useMemo(() => countCharsFromPlain(strippedContent), [strippedContent]);

  // Always show tabs when there's at least one tab
  const showTabs = isDocumentWindow && tabs.length >= 1;
  const showNewTabButton = isDocumentWindow;

  // When hidden (Cmd+J toggled), don't render
  if (!statusBarVisible) return null;

  return (
    <>
      <div className="status-bar-container visible" onKeyDown={preventSelectAllOnButtons}>
        <div className="status-bar">
          {/* Left section: tabs */}
          <div className="status-bar-left">
            {/* New tab button - always on the left */}
            {showNewTabButton && (
              <button
                type="button"
                className="status-new-tab"
                onClick={handleNewTab}
                aria-label="New tab"
                title="New Tab"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}

            {/* Tabs section (pill style) */}
            {showTabs && (
              <div className="status-tabs" role="tablist">
                {tabs.map((tab) => (
                  <Tab
                    key={tab.id}
                    tab={tab}
                    isActive={tab.id === activeTabId}
                    onActivate={() => handleActivateTab(tab.id)}
                    onClose={() => handleCloseTab(tab.id)}
                    onContextMenu={(e) => handleContextMenu(e, tab)}
                  />
                ))}
              </div>
            )}

          </div>

          {/* Right section: stats + mode */}
          <div className="status-bar-right">
            {/* MCP status indicator */}
            <button
              className={`status-mcp ${mcpRunning ? "connected" : ""} ${mcpLoading ? "loading" : ""}`}
              onClick={openMcpDialog}
              title={mcpLoading ? "MCP: Starting..." : mcpRunning ? "MCP: Connected" : "MCP: Disconnected"}
            >
              <Radio size={12} />
              <span className="status-mcp-label">MCP</span>
            </button>

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
              <span
                className="status-autosave"
                title={`Auto-saved at ${formatExactTime(lastAutoSave)}`}
              >
                <Save size={12} />
                {autoSaveTime}
              </span>
            )}
            <span className="status-item">{wordCount} words</span>
            <span className="status-item">{charCount} chars</span>
            <button
              className="status-mode"
              title={sourceMode ? `Source Mode (${formatKeyForDisplay(sourceModeShortcut)})` : `Rich Text Mode (${formatKeyForDisplay(sourceModeShortcut)})`}
              onClick={() => {
                // Close any open image paste toast (don't paste - user is switching modes)
                const toastStore = useImagePasteToastStore.getState();
                if (toastStore.isOpen) {
                  toastStore.hideToast();
                }
                flushActiveWysiwygNow();
                useViewSettingsStore.getState().toggleSourceMode();
              }}
            >
              {sourceMode ? <Code2 size={14} /> : <Type size={12} />}
            </button>
          </div>
        </div>
      </div>

      {/* Tab context menu */}
      {contextMenu && (
        <TabContextMenu
          tab={contextMenu.tab}
          position={contextMenu.position}
          windowLabel={windowLabel}
          onClose={handleCloseContextMenu}
        />
      )}
    </>
  );
}

export default StatusBar;
