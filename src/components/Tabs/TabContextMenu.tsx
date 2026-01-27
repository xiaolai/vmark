import { useCallback, useEffect, useRef } from "react";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { closeTabWithDirtyCheck, closeTabsWithDirtyCheck } from "@/hooks/useTabOperations";
import { saveToPath } from "@/utils/saveToPath";
import { isImeKeyEvent } from "@/utils/imeGuard";
import "./TabContextMenu.css";

export interface ContextMenuPosition {
  x: number;
  y: number;
}

interface TabContextMenuProps {
  tab: Tab;
  position: ContextMenuPosition;
  windowLabel: string;
  onClose: () => void;
}

interface MenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  separator?: boolean;
}

export function TabContextMenu({
  tab,
  position,
  windowLabel,
  onClose,
}: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const tabs = useTabStore((state) => state.tabs[windowLabel] ?? []);
  const doc = useDocumentStore((state) => state.documents[tab.id]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Position adjustment to keep menu in viewport
  useEffect(() => {
    if (!menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = position.x;
    let adjustedY = position.y;

    // Adjust horizontal position
    if (position.x + rect.width > viewportWidth - 10) {
      adjustedX = viewportWidth - rect.width - 10;
    }

    // Adjust vertical position - show above if would overflow bottom
    if (position.y + rect.height > viewportHeight - 10) {
      adjustedY = position.y - rect.height - 5;
      // If still overflows top, pin to top with margin
      if (adjustedY < 10) {
        adjustedY = 10;
      }
    }

    menu.style.left = `${adjustedX}px`;
    menu.style.top = `${adjustedY}px`;
  }, [position]);

  const handleClose = useCallback(async () => {
    await closeTabWithDirtyCheck(windowLabel, tab.id);
    onClose();
  }, [windowLabel, tab.id, onClose]);

  const handleCloseOthers = useCallback(async () => {
    const tabsToClose = tabs.filter((t) => t.id !== tab.id && !t.isPinned);
    const tabIds = tabsToClose.map((t) => t.id);
    await closeTabsWithDirtyCheck(windowLabel, tabIds);
    onClose();
  }, [tabs, tab.id, windowLabel, onClose]);

  const handleCloseToRight = useCallback(async () => {
    const tabIndex = tabs.findIndex((t) => t.id === tab.id);
    const tabsToClose = tabs.filter((t, i) => i > tabIndex && !t.isPinned);
    const tabIds = tabsToClose.map((t) => t.id);
    await closeTabsWithDirtyCheck(windowLabel, tabIds);
    onClose();
  }, [tabs, tab.id, windowLabel, onClose]);

  const handleCloseAll = useCallback(async () => {
    const tabsToClose = tabs.filter((t) => !t.isPinned);
    const tabIds = tabsToClose.map((t) => t.id);
    await closeTabsWithDirtyCheck(windowLabel, tabIds);
    onClose();
  }, [tabs, windowLabel, onClose]);

  const handlePin = useCallback(() => {
    useTabStore.getState().togglePin(windowLabel, tab.id);
    onClose();
  }, [windowLabel, tab.id, onClose]);

  // Restore missing file to original location
  const handleRestoreToDisk = useCallback(async () => {
    if (!doc?.filePath) return;
    const saved = await saveToPath(tab.id, doc.filePath, doc.content, "manual");
    if (saved) {
      useDocumentStore.getState().clearMissing(tab.id);
    }
    onClose();
  }, [tab.id, doc?.filePath, doc?.content, onClose]);

  // Copy file path to clipboard
  const handleCopyPath = useCallback(async () => {
    if (!doc?.filePath) return;
    await navigator.clipboard.writeText(doc.filePath);
    onClose();
  }, [doc?.filePath, onClose]);

  const tabIndex = tabs.findIndex((t) => t.id === tab.id);
  const hasTabsToRight = tabs.slice(tabIndex + 1).some((t) => !t.isPinned);
  const hasOtherTabs = tabs.filter((t) => t.id !== tab.id && !t.isPinned).length > 0;

  // Build menu items dynamically based on state
  const menuItems: MenuItem[] = [
    {
      label: tab.isPinned ? "Unpin" : "Pin",
      action: handlePin,
    },
    {
      label: "Copy Path",
      action: handleCopyPath,
      disabled: !doc?.filePath,
    },
    // Show "Restore to Disk" when file is missing
    ...(doc?.isMissing && doc.filePath
      ? [
          {
            label: "Restore to Disk",
            action: handleRestoreToDisk,
          },
        ]
      : []),
    { label: "", action: () => {}, separator: true },
    {
      label: "Close",
      action: handleClose,
      disabled: tab.isPinned,
    },
    {
      label: "Close Others",
      action: handleCloseOthers,
      disabled: !hasOtherTabs,
    },
    {
      label: "Close to the Right",
      action: handleCloseToRight,
      disabled: !hasTabsToRight,
    },
    {
      label: "Close All",
      action: handleCloseAll,
      disabled: tabs.every((t) => t.isPinned),
    },
  ];

  return (
    <div
      ref={menuRef}
      className="tab-context-menu"
      style={{ left: position.x, top: position.y }}
    >
      {menuItems.map((item, index) =>
        item.separator ? (
          <div key={`separator-${index}`} className="tab-context-menu-separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            className="tab-context-menu-item"
            onClick={item.action}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

export default TabContextMenu;
