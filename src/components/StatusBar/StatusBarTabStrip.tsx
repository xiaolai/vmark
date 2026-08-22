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
import { useCallback, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronLeft, ChevronRight, Globe2, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tab, OTHER_PANE_DESC_ID } from "@/components/Tabs/Tab";
import type { Tab as TabType } from "@/stores/tabStore";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/settingsStore";
import { tooltipWithShortcut } from "@/utils/tooltipWithShortcut";
import { isRovingNavKey, moveRovingTabFocus } from "@/utils/rovingTabFocus";
import type { useStatusBarTabDrag } from "./useStatusBarTabDrag";
import { useTabStripOverflow } from "@/hooks/useTabStripOverflow";
import { useScrollActiveTabIntoView, prefersReducedMotion } from "./scrollActiveTabIntoView";
import { paneIndicatorTabId } from "./paneIndicator";
import { usePaneStore } from "@/stores/paneStore";
import { useWindowLabel } from "@/contexts/WindowContext";

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

  // WI-TNAV1.2 — the strip scrolls with its scrollbar suppressed in both
  // engines, so without these the tabs simply vanish (F1).
  const regionRef = useRef<HTMLDivElement | null>(null);
  // WI-DSPL1.1 (F4) — the non-focused pane's document has no pill state at
  // all otherwise: `activeTabId` is the ADR-1 alias of the FOCUSED pane.
  const windowLabel = useWindowLabel();
  const paneIndicated = usePaneStore((s) =>
    paneIndicatorTabId(s.byWindow[windowLabel], browserWorkspaceActive),
  );
  const { canScrollLeft, canScrollRight } = useTabStripOverflow(regionRef);

  // WI-TNAV1.3 (F2) — keyed on an ACTIVATION KEY, not `activeTabId`: the
  // browser pill is current while `activeTabId` is null, so an activeTabId-only
  // effect could never reveal it.
  useScrollActiveTabIntoView(regionRef, {
    activeTabId,
    browserWorkspaceActive,
    isDragging,
  });

  const scrollByPage = useCallback((direction: -1 | 1) => {
    const node = regionRef.current;
    if (!node) return;
    // Proportional to the visible width, not a constant: a fixed step scrolls
    // most of a narrow strip and a sliver of a wide one.
    //
    // Reduced motion comes from the SAME helper the scroll-into-view effect
    // uses — two copies of the policy meant one preference could produce two
    // behaviours in one strip.
    node.scrollBy({
      left: direction * node.clientWidth * 0.8,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, []);

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
        <div
          className="status-tabs-wrap"
          data-can-scroll-left={canScrollLeft}
          data-can-scroll-right={canScrollRight}
        >
          <div
            className="status-tabs-region"
            role="group"
            aria-label={t("tabStrip")}
            // Focusable so a keyboard user can reach a scroll region whose
            // scrollbar is suppressed. It sits OUTSIDE `role="tablist"`, so the
            // pills' roving arrow-key contract is untouched.
            tabIndex={0}
            ref={regionRef}
          >
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
                isOtherPane={tab.id === paneIndicated}
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
          </div>
          {/* ONE shared description, outside every role="tab" — nested, its text
              would join each tab's accessible name (name-from-content) and be
              announced twice. */}
          {paneIndicated && (
            <span id={OTHER_PANE_DESC_ID} className="sr-only">
              {t("common:tab.otherPane")}
            </span>
          )}
          {canScrollLeft && (
            <button
              type="button"
              className="popup-icon-btn status-tabs-chevron status-tabs-chevron--left"
              aria-label={t("scrollTabsLeft")}
              title={t("scrollTabsLeft")}
              onClick={() => scrollByPage(-1)}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
          )}
          {canScrollRight && (
            <button
              type="button"
              className="popup-icon-btn status-tabs-chevron status-tabs-chevron--right"
              aria-label={t("scrollTabsRight")}
              title={t("scrollTabsRight")}
              onClick={() => scrollByPage(1)}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </>
  );
}
