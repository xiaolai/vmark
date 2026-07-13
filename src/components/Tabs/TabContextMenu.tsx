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
 *   - The menu dismisses itself when its target tab leaves the tab list (closed
 *     from elsewhere, or moved to another window while the menu is open): the
 *     actions hook resolves the tab's index against the live list, and an index
 *     of -1 would make "Close Tabs to the Right" mean "close everything".
 *   - Every activation (pointer or keyboard) goes through one activateItem():
 *     it drops repeat activations while an async action is still running, and
 *     closes the menu if the action rejects, so a failed close can't leave a
 *     dead menu on screen with an unhandled rejection behind it.
 *
 * @coordinates-with useTabContextMenuActions.ts — provides menu item definitions
 * @coordinates-with useMenuPosition.ts — placement + viewport clamping
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
import { useTranslation } from "react-i18next";
import { useDocumentStore } from "@/stores/documentStore";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/settingsStore";
import { useTabStore, tabFilePath, type Tab } from "@/stores/tabStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useDismissOnOutsideOrEscape } from "@/hooks/useDismissOnOutsideOrEscape";
import { getRevealInFileManagerLabel } from "@/utils/pathUtils";
import { tabContextError } from "@/utils/debug";
import { useTabContextMenuActions, type TabMenuItem } from "./useTabContextMenuActions";
import { useMenuPosition, type ContextMenuPosition } from "./useMenuPosition";
import "./TabContextMenu.css";

export type { ContextMenuPosition };

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
  /* v8 ignore next -- @preserve reason: empty focusableIndices guard; menu always has at least one enabled item in tests */
  if (focusableIndices.length === 0) return -1;
  const currentPos = focusableIndices.indexOf(focusedIndex);
  /* v8 ignore next -- @preserve reason: currentPos === -1 branch means focused item not in list; not reached when focus is managed correctly */
  const startPos = currentPos === -1
    ? (direction === 1 ? 0 : focusableIndices.length - 1)
    : (currentPos + direction + focusableIndices.length) % focusableIndices.length;
  /* v8 ignore next -- @preserve reason: ?? -1 fallback only when startPos is out of bounds; always valid with modular arithmetic */
  return focusableIndices[startPos] ?? -1;
}

/** Renders a right-click context menu for a tab with keyboard navigation and viewport-aware positioning. */
export function TabContextMenu({ tab, position, windowLabel, onClose }: TabContextMenuProps) {
  const { t } = useTranslation("common");
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  /* v8 ignore next -- @preserve reason: ?? [] fallback for missing windowLabel key; windowLabel always valid in tests */
  const tabs = useTabStore((state) => state.tabs[windowLabel] ?? []);
  const doc = useDocumentStore((state) => state.documents[tab.id]);
  const workspaceRoot = useWorkspaceStore((state) => state.rootPath);
  const closeShortcut = useShortcutsStore((state) => state.getShortcut("closeFile"));

  const revealLabel = useMemo(() => getRevealInFileManagerLabel(), []);
  const closeShortcutLabel = useMemo(() => formatKeyForDisplay(closeShortcut), [closeShortcut]);
  const filePath = tabFilePath(tab) ?? doc?.filePath ?? null;

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

  // The target tab can vanish while the menu is open (closed from a shortcut,
  // moved to another window). Every tab-relative action would then act on a
  // findIndex() of -1 — "Close Tabs to the Right" would close every unpinned
  // tab. Dismiss instead of operating on a tab that no longer exists.
  const isTabPresent = tabs.some((entry) => entry.id === tab.id);
  useEffect(() => {
    if (!isTabPresent) onClose();
  }, [isTabPresent, onClose]);

  // One activation path for pointer and keyboard alike.
  const runningRef = useRef(false);
  const activateItem = useCallback(
    (item: TabMenuItem) => {
      if (item.separator || item.disabled) return;
      // An action can await a dirty-check dialog while the menu is still up;
      // repeat Enter/clicks would launch a second concurrent close.
      if (runningRef.current) return;
      runningRef.current = true;
      void (async () => {
        try {
          await item.action();
        } catch (error) {
          tabContextError("Tab context menu action failed:", error);
          onClose();
        } finally {
          runningRef.current = false;
        }
      })();
    },
    [onClose]
  );


  // Placement + viewport clamping (see useMenuPosition).
  useMenuPosition(menuRef, position);

  // Close on click outside or Escape (Escape ignored during IME composition).
  useDismissOnOutsideOrEscape(true, menuRef, onClose);

  // Reset focus to the first enabled item when the focusable set changes (incl.
  // on mount). Legitimate setState-in-effect: paired with the DOM-focus effect
  // below; not derivable during render without losing mount-time focus init (#1063).
  useEffect(() => {
    /* v8 ignore next -- @preserve reason: ?? -1 fallback only when focusableIndices is empty; menu always has enabled items in tests */
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        /* v8 ignore next -- @preserve reason: ?? -1 fallback only when focusableIndices empty; always populated in tests */
        setFocusedIndex(focusableIndices[0] ?? -1);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        /* v8 ignore next -- @preserve reason: ?? -1 fallback only when focusableIndices empty; always populated in tests */
        setFocusedIndex(focusableIndices[focusableIndices.length - 1] ?? -1);
        return;
      }

      if (event.key === "Tab") {
        onClose();
        return;
      }

      /* v8 ignore next -- @preserve reason: false branch (other keys) is a no-op fall-through */
      if ((event.key === "Enter" || event.key === " ") && focusedIndex >= 0) {
        const item = menuItems[focusedIndex];
        /* v8 ignore next -- @preserve reason: null item guard; always a valid item at focusedIndex in keyboard tests */
        if (!item) return;
        event.preventDefault();
        activateItem(item);
      }
    },
    [activateItem, focusableIndices, focusedIndex, menuItems, onClose]
  );

  // Defense in depth: the onClose above unmounts us, but never paint a menu
  // whose actions would resolve against a tab that is no longer in the list.
  if (!isTabPresent) return null;

  return (
    <div
      ref={menuRef}
      className="tab-context-menu"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label={t("tabActions")}
      onKeyDown={handleMenuKeyDown}
    >
      {menuItems.map((item, index) =>
        item.separator ? (
          <div
            key={item.id}
            className="tab-context-menu-separator"
            role="separator"
            aria-orientation="horizontal"
          />
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
              activateItem(item);
            }}
            onFocus={() => {
              setFocusedIndex(index);
            }}
            onMouseEnter={() => {
              /* v8 ignore next -- @preserve reason: disabled item hover guard; mouseEnter on disabled items not exercised in tests */
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
