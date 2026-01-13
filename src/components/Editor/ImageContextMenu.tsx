/**
 * Image Context Menu
 *
 * Context menu shown when right-clicking on an image.
 * Provides actions: Change Image, Delete, Copy Path, Reveal in Finder.
 */

import { useEffect, useRef, useCallback } from "react";
import { ImagePlus, Trash2, Copy, FolderOpen } from "lucide-react";
import { useImageContextMenuStore } from "@/stores/imageContextMenuStore";
import "@/components/Sidebar/FileExplorer/ContextMenu.css";
import { isImeKeyEvent } from "@/utils/imeGuard";

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  separator?: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  { id: "change", label: "Change Image...", icon: <ImagePlus size={14} /> },
  {
    id: "delete",
    label: "Delete Image",
    icon: <Trash2 size={14} />,
    separator: true,
  },
  { id: "copyPath", label: "Copy Image Path", icon: <Copy size={14} /> },
  {
    id: "revealInFinder",
    label: "Reveal in Finder",
    icon: <FolderOpen size={14} />,
  },
];

interface ImageContextMenuProps {
  onAction: (action: string) => void;
}

export function ImageContextMenu({ onAction }: ImageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { isOpen, position, closeMenu } = useImageContextMenuStore();

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;
      if (e.key === "Escape") {
        closeMenu();
      }
    };

    // Use capture phase to catch clicks before other handlers
    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, closeMenu]);

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

  const handleItemClick = useCallback(
    (id: string) => {
      onAction(id);
      closeMenu();
    },
    [onAction, closeMenu]
  );

  if (!isOpen || !position) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
    >
      {MENU_ITEMS.map((item, index) => (
        <div key={item.id}>
          {item.separator && index > 0 && (
            <div className="context-menu-separator" />
          )}
          <div
            className="context-menu-item"
            onClick={() => handleItemClick(item.id)}
          >
            <span className="context-menu-item-icon">{item.icon}</span>
            <span className="context-menu-item-label">{item.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
