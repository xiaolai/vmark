/**
 * TabContextMenu
 *
 * Purpose: Right-click context menu for tabs — provides actions like close,
 * close others, pin/unpin, move to new window, copy path, reveal in file
 * manager, revert to saved, and restore deleted files.
 *
 * User interactions:
 *   - Arrow keys navigate menu items; Enter/Space activates
 *   - Escape or click-outside closes the menu
 *   - Tab key closes the menu (returns focus to tab strip)
 *
 * Key decisions:
 *   - Menu items are built by useTabContextMenuActions hook, which handles
 *     enable/disable logic and action callbacks based on tab/document state.
 *   - Uses roving tabindex with focusableIndices to skip separators and
 *     disabled items during keyboard navigation.
 *   - Position auto-adjusts to stay within viewport (right/bottom overflow).
 *   - Listens for viewport resize/scroll to reposition dynamically.
 *
 * @coordinates-with useTabContextMenuActions.ts — provides menu item definitions
 * @coordinates-with StatusBar.tsx — triggers this menu on tab right-click
 * @module components/Tabs/TabContextMenu
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useDocumentStore } from "@/stores/documentStore";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/shortcutsStore";
import { useTabStore, type Tab } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { getRevealInFileManagerLabel } from "@/utils/pathUtils";
import { useTabContextMenuActions } from "./useTabContextMenuActions";
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

function findNextFocusable(
  focusableIndices: number[],
  focusedIndex: number,
  direction: 1 | -1
): number {
  if (focusableIndices.length === 0) return -1;
  const currentPos = focusableIndices.indexOf(focusedIndex);
  const startPos = currentPos === -1
    ? (direction === 1 ? 0 : focusableIndices.length - 1)
    : (currentPos + direction + focusableIndices.length) % focusableIndices.length;
  return focusableIndices[startPos] ?? -1;
}

export function TabContextMenu({ tab, position, windowLabel, onClose }: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const positionRef = useRef(position);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const tabs = useTabStore((state) => state.tabs[windowLabel] ?? []);
  const doc = useDocumentStore((state) => state.documents[tab.id]);
  const workspaceRoot = useWorkspaceStore((state) => state.rootPath);
  const closeShortcut = useShortcutsStore((state) => state.getShortcut("closeFile"));

  const revealLabel = useMemo(() => getRevealInFileManagerLabel(), []);
  const closeShortcutLabel = useMemo(() => formatKeyForDisplay(closeShortcut), [closeShortcut]);
  const filePath = tab.filePath ?? doc?.filePath ?? null;

  const menuItems = useTabContextMenuActions({
    tab,
    tabs,
    doc,
    filePath,
    windowLabel,
    workspaceRoot,
    revealLabel,
    closeShortcutLabel,
    onClose,
  });

  const focusableIndices = useMemo(
    () => menuItems
      .map((item, index) => (!item.separator && !item.disabled ? index : -1))
      .filter((index) => index !== -1),
    [menuItems]
  );

  const applyMenuPosition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = positionRef.current.x;
    let adjustedY = positionRef.current.y;

    if (adjustedX + rect.width > viewportWidth - 10) {
      adjustedX = Math.max(10, viewportWidth - rect.width - 10);
    }
    if (adjustedY + rect.height > viewportHeight - 10) {
      adjustedY = Math.max(10, viewportHeight - rect.height - 10);
    }

    menu.style.left = `${adjustedX}px`;
    menu.style.top = `${adjustedY}px`;
  }, []);

  useEffect(() => {
    positionRef.current = position;
    applyMenuPosition();
  }, [applyMenuPosition, position]);

  useEffect(() => {
    const handleViewportChange = () => applyMenuPosition();
    const visualViewport = window.visualViewport;

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    visualViewport?.addEventListener("resize", handleViewportChange);
    visualViewport?.addEventListener("scroll", handleViewportChange);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      visualViewport?.removeEventListener("resize", handleViewportChange);
      visualViewport?.removeEventListener("scroll", handleViewportChange);
    };
  }, [applyMenuPosition]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (isImeKeyEvent(event)) return;
      if (event.key === "Escape") {
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

  useEffect(() => {
    setFocusedIndex(focusableIndices[0] ?? -1);
  }, [focusableIndices]);

  useEffect(() => {
    if (focusedIndex < 0) return;
    itemRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  const handleMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (isImeKeyEvent(event.nativeEvent)) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setFocusedIndex((current) => findNextFocusable(focusableIndices, current, 1));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setFocusedIndex((current) => findNextFocusable(focusableIndices, current, -1));
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setFocusedIndex(focusableIndices[0] ?? -1);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setFocusedIndex(focusableIndices[focusableIndices.length - 1] ?? -1);
        return;
      }

      if (event.key === "Tab") {
        onClose();
        return;
      }

      if ((event.key === "Enter" || event.key === " ") && focusedIndex >= 0) {
        const item = menuItems[focusedIndex];
        if (!item || item.separator || item.disabled) return;
        event.preventDefault();
        void item.action();
      }
    },
    [focusableIndices, focusedIndex, menuItems, onClose]
  );

  return (
    <div
      ref={menuRef}
      className="tab-context-menu"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label="Tab actions"
      onKeyDown={handleMenuKeyDown}
    >
      {menuItems.map((item, index) =>
        item.separator ? (
          <div key={item.id} className="tab-context-menu-separator" />
        ) : (
          <button
            key={item.id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role="menuitem"
            className="tab-context-menu-item"
            onClick={() => {
              void item.action();
            }}
            onFocus={() => {
              setFocusedIndex(index);
            }}
            onMouseEnter={() => {
              if (!item.disabled) {
                setFocusedIndex(index);
              }
            }}
            disabled={item.disabled}
            tabIndex={focusedIndex === index ? 0 : -1}
          >
            <span className="tab-context-menu-item-label">{item.label}</span>
            {item.shortcut && <span className="tab-context-menu-item-shortcut">{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  );
}

export default TabContextMenu;
