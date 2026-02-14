import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Plus } from "lucide-react";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { useWindowLabel, useIsDocumentWindow } from "@/contexts/WindowContext";
import { useTabStore, type Tab as TabType } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { closeTabWithDirtyCheck } from "@/hooks/useTabOperations";
import {
  useDocumentContent,
  useDocumentLastAutoSave,
  useDocumentIsMissing,
  useDocumentIsDivergent,
} from "@/hooks/useDocumentState";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAiInvocationStore } from "@/stores/aiInvocationStore";
import { formatRelativeTime } from "@/utils/dateUtils";
import { Tab } from "@/components/Tabs/Tab";
import { TabContextMenu, type ContextMenuPosition } from "@/components/Tabs/TabContextMenu";
import { useShortcutsStore } from "@/stores/shortcutsStore";
import { useMcpServer } from "@/hooks/useMcpServer";
import { useMcpClients } from "@/hooks/useMcpClients";
import { openSettingsWindow } from "@/utils/settingsWindow";
import { countCharsFromPlain, countWordsFromPlain, stripMarkdown } from "./statusTextMetrics";
import { StatusBarRight } from "./StatusBarRight";
import { useStatusBarTabDrag } from "./useStatusBarTabDrag";
import { useQuitFeedback } from "./useQuitFeedback";
import "./StatusBar.css";

// Stable empty array to avoid creating new reference on each render.
const EMPTY_TABS: never[] = [];

const ARIA_LIVE_STYLE = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

/**
 * Prevent Cmd+A from selecting all page content when focus is on non-input elements.
 * Only prevents when active element is a button or similar non-text element.
 */
function preventSelectAllOnButtons(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === "a") {
    const target = event.target as HTMLElement;
    if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
      event.preventDefault();
    }
  }
}

export function StatusBar() {
  const isDocumentWindow = useIsDocumentWindow();
  const windowLabel = useWindowLabel();
  const content = useDocumentContent();
  const lastAutoSave = useDocumentLastAutoSave();
  const isMissing = useDocumentIsMissing();
  const isDivergent = useDocumentIsDivergent();
  const autoSaveEnabled = useSettingsStore((state) => state.general.autoSaveEnabled);
  const sourceMode = useEditorStore((state) => state.sourceMode);
  const statusBarVisible = useUIStore((state) => state.statusBarVisible);
  const terminalVisible = useUIStore((state) => state.terminalVisible);
  const sourceModeShortcut = useShortcutsStore((state) => state.getShortcut("sourceMode"));
  const terminalShortcut = useShortcutsStore((state) => state.getShortcut("toggleTerminal"));
  const aiRunning = useAiInvocationStore((state) => state.isRunning);
  const { running: mcpRunning, loading: mcpLoading, error: mcpError } = useMcpServer();
  const mcpClients = useMcpClients(mcpRunning);

  const openMcpSettings = useCallback(() => openSettingsWindow("integrations"), []);
  const showAutoSavePaused = isMissing && autoSaveEnabled;

  const tabs = useTabStore((state) => (isDocumentWindow ? state.tabs[windowLabel] ?? EMPTY_TABS : EMPTY_TABS));
  const activeTabId = useTabStore((state) => (isDocumentWindow ? state.activeTabId[windowLabel] : null));

  const [contextMenu, setContextMenu] = useState<{
    position: ContextMenuPosition;
    tab: TabType;
  } | null>(null);
  const [showAutoSave, setShowAutoSave] = useState(false);
  const [autoSaveTime, setAutoSaveTime] = useState("");
  const quitMessage = useQuitFeedback();

  const tabDragScopeRef = useRef<HTMLDivElement>(null);

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

  const handleContextMenu = useCallback((event: MouseEvent, tab: TabType) => {
    event.preventDefault();
    setContextMenu({
      position: { x: event.clientX, y: event.clientY },
      tab,
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleNewTab = useCallback(() => {
    const tabId = useTabStore.getState().createTab(windowLabel, null);
    useDocumentStore.getState().initDocument(tabId, "", null);
  }, [windowLabel]);

  const {
    getTabDragHandlers,
    isDragging,
    isReordering,
    dragMode,
    dragTabId,
    dropIndex,
    dragPoint,
    snapbackTabId,
    isDropPreviewTarget,
    isDropInvalid,
    isReorderBlocked,
    dragHint,
    ariaAnnouncement,
    handleTabKeyDown,
  } = useStatusBarTabDrag({
    tabs,
    windowLabel,
    tabBarRef: tabDragScopeRef,
    onActivateTab: handleActivateTab,
  });

  const dragTab = dragTabId ? tabs.find((tab) => tab.id === dragTabId) ?? null : null;

  const strippedContent = useMemo(() => stripMarkdown(content), [content]);
  const wordCount = useMemo(() => countWordsFromPlain(strippedContent), [strippedContent]);
  const charCount = useMemo(() => countCharsFromPlain(strippedContent), [strippedContent]);

  const showTabs = isDocumentWindow && tabs.length >= 1;
  const showNewTabButton = isDocumentWindow;

  if (!statusBarVisible && !aiRunning) return null;

  return (
    <>
      <div
        className={`status-bar-container visible${isDropPreviewTarget ? " status-bar-container--drop-target" : ""}`}
        onKeyDown={preventSelectAllOnButtons}
      >
        <div className="status-bar">
          <div className="status-bar-left" ref={tabDragScopeRef}>
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

            {showTabs && (
              <div className="status-tabs" role="tablist">
                {tabs.map((tab, index) => {
                  const dragHandlers = getTabDragHandlers(tab.id, tab.isPinned);
                  const isBeingDragged = dragTabId === tab.id;
                  const showDropBefore = isReordering && dropIndex === index && !isBeingDragged && !isReorderBlocked;

                  return (
                    <Tab
                      key={tab.id}
                      tab={tab}
                      isActive={tab.id === activeTabId}
                      isDragTarget={isDragging && isBeingDragged}
                      isReordering={isReordering && isBeingDragged}
                      isInvalidDrop={isDropInvalid && isBeingDragged}
                      isSnapback={snapbackTabId === tab.id}
                      showDropIndicator={showDropBefore}
                      onActivate={() => handleActivateTab(tab.id)}
                      onKeyDown={(event) => handleTabKeyDown(tab.id, event)}
                      onClose={() => handleCloseTab(tab.id)}
                      onContextMenu={(event) => handleContextMenu(event, tab)}
                      onPointerDown={dragHandlers.onPointerDown}
                    />
                  );
                })}
                {isReordering && dropIndex !== null && dropIndex >= tabs.length && !isReorderBlocked && (
                  <div className="tab-drop-indicator" />
                )}
              </div>
            )}

            {quitMessage && (
              <span className="status-quit-message">
                Press {navigator.platform.includes("Mac") ? "⌘Q" : "Ctrl+Q"} again to quit
              </span>
            )}
          </div>

          <StatusBarRight
            aiRunning={aiRunning}
            mcpRunning={mcpRunning}
            mcpLoading={mcpLoading}
            mcpError={mcpError}
            mcpClients={mcpClients}
            openMcpSettings={openMcpSettings}
            showAutoSavePaused={showAutoSavePaused}
            isDivergent={isDivergent}
            showAutoSave={showAutoSave}
            lastAutoSave={lastAutoSave}
            autoSaveTime={autoSaveTime}
            wordCount={wordCount}
            charCount={charCount}
            terminalVisible={terminalVisible}
            terminalShortcut={terminalShortcut}
            sourceMode={sourceMode}
            sourceModeShortcut={sourceModeShortcut}
            onToggleSourceMode={() => useEditorStore.getState().toggleSourceMode()}
          />
        </div>
      </div>

      {dragPoint && dragTab && dragMode !== "idle" && (
        <div
          className={`tab-drag-ghost${isDropInvalid ? " invalid" : ""}`}
          style={{ transform: `translate3d(${dragPoint.clientX + 14}px, ${dragPoint.clientY + 14}px, 0)` }}
        >
          <span className="tab-drag-ghost-title">{dragTab.title}</span>
          <span className="tab-drag-ghost-hint">{dragHint}</span>
        </div>
      )}

      <div aria-live="polite" aria-atomic="true" style={ARIA_LIVE_STYLE}>
        {ariaAnnouncement}
      </div>

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
