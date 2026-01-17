import { useMemo, useState, useEffect, useCallback, type MouseEvent } from "react";

// Stable empty array to avoid creating new reference on each render
const EMPTY_TABS: never[] = [];
import { Code2, Type, Save, Plus } from "lucide-react";
import { countWords as alfaazCount } from "alfaaz";
import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWindowLabel, useIsDocumentWindow } from "@/contexts/WindowContext";
import { useTabStore, type Tab as TabType } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import { flushActiveWysiwygNow } from "@/utils/wysiwygFlush";
import {
  useDocumentContent,
  useDocumentLastAutoSave,
} from "@/hooks/useDocumentState";
import { formatRelativeTime, formatExactTime } from "@/utils/dateUtils";
import { Tab } from "@/components/Tabs/Tab";
import { TabContextMenu, type ContextMenuPosition } from "@/components/Tabs/TabContextMenu";
import "./StatusBar.css";

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

function countWords(text: string): number {
  const plainText = stripMarkdown(text);
  return alfaazCount(plainText);
}

function countCharacters(text: string): number {
  const plainText = stripMarkdown(text);
  return plainText.replace(/\s/g, "").length;
}

export function StatusBar() {
  const isDocumentWindow = useIsDocumentWindow();
  const windowLabel = useWindowLabel();
  const content = useDocumentContent();
  const lastAutoSave = useDocumentLastAutoSave();
  const sourceMode = useEditorStore((state) => state.sourceMode);
  const autoHideStatusBar = useSettingsStore((state) => state.appearance.autoHideStatusBar);

  // Tab state - only for document windows
  // Use stable EMPTY_TABS to avoid infinite loop from new array reference
  const tabs = useTabStore((state) =>
    isDocumentWindow ? state.tabs[windowLabel] ?? EMPTY_TABS : EMPTY_TABS
  );
  const activeTabId = useTabStore((state) =>
    isDocumentWindow ? state.activeTabId[windowLabel] : null
  );

  // Status bar visibility:
  // - When autoHideStatusBar is OFF (default): always visible
  // - When autoHideStatusBar is ON: only show on hover (no visible class, relies on CSS :hover)
  const statusBarVisible = !(autoHideStatusBar ?? false);

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

  const wordCount = useMemo(() => countWords(content), [content]);
  const charCount = useMemo(() => countCharacters(content), [content]);

  // Always show tabs when there's at least one tab
  const showTabs = isDocumentWindow && tabs.length >= 1;
  const showNewTabButton = isDocumentWindow;

  return (
    <>
      <div className={`status-bar-container ${statusBarVisible ? "visible" : ""}`}>
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
            {showAutoSave && lastAutoSave && (
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
              title={sourceMode ? "Source Mode (F7)" : "Rich Text Mode (F7)"}
              onClick={() => {
                flushActiveWysiwygNow();
                useEditorStore.getState().toggleSourceMode();
              }}
            >
              {sourceMode ? <Code2 size={14} /> : <Type size={14} />}
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
