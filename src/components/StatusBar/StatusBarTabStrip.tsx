/**
 * StatusBarTabStrip
 *
 * Purpose: Renders the StatusBar's tab list (the "+" new-tab button, the tab
 * pills with drag/drop state, and the trailing drop indicator). Split out of
 * StatusBar so that component focuses on state wiring rather than tab markup.
 * Behavior preserved verbatim.
 *
 * @coordinates-with StatusBar.tsx — parent
 * @coordinates-with Tabs/Tab.tsx — individual tab pill
 * @module components/StatusBar/StatusBarTabStrip
 */
import type { KeyboardEvent, MouseEvent } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tab } from "@/components/Tabs/Tab";
import type { Tab as TabType } from "@/stores/tabStore";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/settingsStore";
import { tooltipWithShortcut } from "@/utils/tooltipWithShortcut";
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
          {isReordering &&
            dropIndex !== null &&
            dropIndex >= tabs.length &&
            !isReorderBlocked && <div className="tab-drop-indicator" />}
        </div>
      )}
    </>
  );
}
