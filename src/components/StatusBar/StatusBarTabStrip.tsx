/**
 * StatusBarTabStrip
 *
 * Purpose: Renders the StatusBar's tab list (the "+" new-tab button, the tab
 * pills with drag/drop state, the trailing drop indicator, and the synthetic
 * browser-workspace tab). Split out of StatusBar so that component focuses on
 * state wiring rather than tab markup. The workspace tab is a roving APG tab
 * (keyboard-navigable) and is excluded from reorder drop-index math.
 *
 * @coordinates-with StatusBar.tsx — parent
 * @coordinates-with Tabs/Tab.tsx — individual tab pill
 * @module components/StatusBar/StatusBarTabStrip
 */
import type { KeyboardEvent, MouseEvent } from "react";
import { Globe2, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tab } from "@/components/Tabs/Tab";
import type { Tab as TabType } from "@/stores/tabStore";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/settingsStore";
import { tooltipWithShortcut } from "@/utils/tooltipWithShortcut";
import { isRovingNavKey, moveRovingTabFocus } from "@/utils/rovingTabFocus";
import type { useStatusBarTabDrag } from "./useStatusBarTabDrag";

type TabDragResult = ReturnType<typeof useStatusBarTabDrag>;

interface StatusBarTabStripProps {
  tabs: TabType[];
  activeTabId: string | null;
  showTabs: boolean;
  showNewTabButton: boolean;
  isDragging: boolean;
  isReordering: boolean;
  dragTabId: string | null;
  dropIndex: number | null;
  isDropInvalid: boolean;
  isReorderBlocked: boolean;
  snapbackTabId: string | null;
  getTabDragHandlers: TabDragResult["getTabDragHandlers"];
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onContextMenu: (event: MouseEvent, tab: TabType) => void;
  onTabKeyDown: (tabId: string, event: KeyboardEvent) => void;
  onNewTab: () => void;
  browserWorkspaceCount?: number;
  browserWorkspaceActive?: boolean;
  /** Required so a visible workspace tab can never silently do nothing. */
  onActivateBrowserWorkspace: () => void;
}

export function StatusBarTabStrip({
  tabs,
  activeTabId,
  showTabs,
  showNewTabButton,
  isDragging,
  isReordering,
  dragTabId,
  dropIndex,
  isDropInvalid,
  isReorderBlocked,
  snapbackTabId,
  getTabDragHandlers,
  onActivateTab,
  onCloseTab,
  onContextMenu,
  onTabKeyDown,
  onNewTab,
  browserWorkspaceCount = 0,
  browserWorkspaceActive = false,
  onActivateBrowserWorkspace,
}: StatusBarTabStripProps) {
  const { t } = useTranslation("statusbar");
  const newTabShortcut = useShortcutsStore((state) => state.getShortcut("newTab"));
  const newTabTooltip = tooltipWithShortcut(t("newTabTitle"), formatKeyForDisplay(newTabShortcut));

  return (
    <>
      {showNewTabButton && (
        <button
          type="button"
          className="status-new-tab"
          onClick={onNewTab}
          aria-label={newTabTooltip}
          title={newTabTooltip}
        >
          <Plus className="w-3 h-3" />
        </button>
      )}

      {showTabs && (
        <div className="status-tabs" role="tablist">
          {tabs.map((tab, index) => {
            const dragHandlers = getTabDragHandlers(tab.id, tab.isPinned);
            const isBeingDragged = dragTabId === tab.id;
            const showDropBefore =
              isReordering && dropIndex === index && !isBeingDragged && !isReorderBlocked;

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
                onActivate={onActivateTab}
                onKeyDown={onTabKeyDown}
                onClose={onCloseTab}
                onContextMenu={onContextMenu}
                onPointerDown={dragHandlers.onPointerDown}
              />
            );
          })}
          {/* Trailing drop indicator sits before the workspace tab: reorder
              drops target document tabs only, so the end-of-list marker belongs
              after the last document, not after the synthetic workspace tab. */}
          {isReordering &&
            dropIndex !== null &&
            dropIndex >= tabs.length &&
            !isReorderBlocked && <div className="tab-drop-indicator" />}
          {browserWorkspaceCount > 0 && (
            <button
              type="button"
              role="tab"
              // Excluded from reorder drop-index math (it is not a document tab).
              data-workspace-tab
              aria-selected={browserWorkspaceActive}
              // Roving tabindex: focusable directly only when it is the active tab.
              tabIndex={browserWorkspaceActive ? 0 : -1}
              className={`browser-workspace-tab${browserWorkspaceActive ? " active" : ""}`}
              onClick={onActivateBrowserWorkspace}
              onKeyDown={(event) => {
                // A native button already activates on Enter/Space; only the
                // roving arrow/home/end navigation needs handling here.
                if (isRovingNavKey(event.key) && moveRovingTabFocus(event.currentTarget, event.key)) {
                  event.preventDefault();
                }
              }}
              title={t("browserWorkspace")}
            >
              <Globe2 size={14} aria-hidden="true" />
              <span>{t("browserWorkspace")}</span>
              {browserWorkspaceCount > 1 && (
                <span className="browser-workspace-count">{browserWorkspaceCount}</span>
              )}
            </button>
          )}
        </div>
      )}
    </>
  );
}
