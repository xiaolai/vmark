/**
 * Image Context Menu
 *
 * Context menu shown when right-clicking on an image.
 * Provides actions: Change Image, Delete, Copy Path, Reveal in file manager.
 *
 * User interactions:
 *   - Arrow keys navigate menu items; Home/End jump to first/last
 *   - Enter/Space activates the focused item
 *   - Escape, Tab, or click-outside closes the menu
 *
 * Accessibility:
 *   - Container is role="menu" with an aria-label; items are role="menuitem"
 *     buttons using a roving tabindex (focused item tabIndex=0, others -1).
 *   - First item is focused when the menu opens.
 *
 * @coordinates-with imageContextMenuStore.ts — open/position/close state
 */

import {
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ImagePlus, Trash2, Copy, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useImageContextMenuStore } from "@/stores/imageContextMenuStore";
import "@/components/Sidebar/FileExplorer/ContextMenu.css";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useDismissOnOutsideOrEscape } from "@/hooks/useDismissOnOutsideOrEscape";
import { getRevealInFileManagerLabel } from "@/utils/pathUtils";

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  separator?: boolean;
}

function buildMenuItems(
  revealLabel: string,
  changeLabel: string,
  deleteLabel: string,
  copyLabel: string
): MenuItem[] {
  return [
    { id: "change", label: changeLabel, icon: <ImagePlus size={14} /> },
    {
      id: "delete",
      label: deleteLabel,
      icon: <Trash2 size={14} />,
      separator: true,
    },
    { id: "copyPath", label: copyLabel, icon: <Copy size={14} /> },
    {
      id: "revealInFinder",
      label: revealLabel,
      icon: <FolderOpen size={14} />,
    },
  ];
}

function findNextFocusable(total: number, current: number, direction: 1 | -1): number {
  /* v8 ignore next -- @preserve reason: empty menu guard; menu always has items */
  if (total === 0) return -1;
  if (current === -1) return direction === 1 ? 0 : total - 1;
  return (current + direction + total) % total;
}

interface ImageContextMenuProps {
  onAction: (action: string) => void;
}

/** Renders a right-click context menu for image nodes (change, delete, copy path, reveal). */
export function ImageContextMenu({ onAction }: ImageContextMenuProps) {
  const { t } = useTranslation("editor");
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const isOpen = useImageContextMenuStore((s) => s.isOpen);
  const position = useImageContextMenuStore((s) => s.position);
  const closeMenu = useImageContextMenuStore((s) => s.closeMenu);
  // Get platform-appropriate label once (stable across renders)
  const revealLabel = useMemo(() => getRevealInFileManagerLabel(), []);
  const menuItems = useMemo(
    () =>
      buildMenuItems(
        revealLabel,
        t("imageMenu.changeImage"),
        t("imageMenu.deleteImage"),
        t("imageMenu.copyPath")
      ),
    [revealLabel, t]
  );

  // Close on click outside or Escape (Escape ignored during IME composition).
  useDismissOnOutsideOrEscape(isOpen, menuRef, closeMenu);

  // Position adjustment to keep menu in viewport
  useEffect(() => {
    if (!menuRef.current || !position) return;

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

    // Adjust vertical position
    if (position.y + rect.height > viewportHeight - 10) {
      adjustedY = viewportHeight - rect.height - 10;
    }

    menu.style.left = `${adjustedX}px`;
    menu.style.top = `${adjustedY}px`;
  }, [position]);

  // Focus the first item whenever the menu opens.
  useEffect(() => {
    setFocusedIndex(isOpen ? 0 : -1);
  }, [isOpen]);

  // Move DOM focus when focusedIndex changes.
  useEffect(() => {
    if (focusedIndex < 0) return;
    itemRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  const handleItemClick = useCallback(
    (id: string) => {
      onAction(id);
      closeMenu();
    },
    [onAction, closeMenu]
  );

  const handleMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (isImeKeyEvent(event.nativeEvent)) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setFocusedIndex((current) => findNextFocusable(menuItems.length, current, 1));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setFocusedIndex((current) => findNextFocusable(menuItems.length, current, -1));
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setFocusedIndex(0);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setFocusedIndex(menuItems.length - 1);
        return;
      }

      if (event.key === "Tab") {
        closeMenu();
        return;
      }

      if ((event.key === "Enter" || event.key === " ") && focusedIndex >= 0) {
        event.preventDefault();
        const item = menuItems[focusedIndex];
        /* v8 ignore next -- @preserve reason: null item guard; focusedIndex always valid in tests */
        if (!item) return;
        handleItemClick(item.id);
      }
    },
    [menuItems, focusedIndex, closeMenu, handleItemClick]
  );

  if (!isOpen || !position) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label={t("imageMenu.ariaLabel")}
      onKeyDown={handleMenuKeyDown}
    >
      {menuItems.map((item, index) => (
        <div key={item.id}>
          {item.separator && index > 0 && (
            <div className="context-menu-separator" />
          )}
          <button
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role="menuitem"
            className="context-menu-item"
            onClick={() => handleItemClick(item.id)}
            onFocus={() => setFocusedIndex(index)}
            onMouseEnter={() => setFocusedIndex(index)}
            tabIndex={focusedIndex === index ? 0 : -1}
          >
            <span className="context-menu-item-icon">{item.icon}</span>
            <span className="context-menu-item-label">{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
