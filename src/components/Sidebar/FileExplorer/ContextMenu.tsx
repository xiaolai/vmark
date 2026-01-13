import { useEffect, useRef, useCallback } from "react";
import {
  FileText,
  FolderPlus,
  FilePlus,
  Pencil,
  Trash2,
  Copy,
  FolderOpen,
} from "lucide-react";
import { isImeKeyEvent } from "@/utils/imeGuard";
import "./ContextMenu.css";

export type ContextMenuType = "file" | "folder" | "empty";

export interface ContextMenuPosition {
  x: number;
  y: number;
}

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  separator?: boolean;
}

const FILE_MENU_ITEMS: MenuItem[] = [
  { id: "open", label: "Open", icon: <FileText size={14} /> },
  { id: "rename", label: "Rename", icon: <Pencil size={14} />, separator: true },
  { id: "duplicate", label: "Duplicate", icon: <Copy size={14} /> },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} />, separator: true },
  { id: "copyPath", label: "Copy Path", icon: <Copy size={14} /> },
  { id: "revealInFinder", label: "Reveal in Finder", icon: <FolderOpen size={14} /> },
];

const FOLDER_MENU_ITEMS: MenuItem[] = [
  { id: "newFile", label: "New File", icon: <FilePlus size={14} /> },
  { id: "newFolder", label: "New Folder", icon: <FolderPlus size={14} />, separator: true },
  { id: "rename", label: "Rename", icon: <Pencil size={14} /> },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} />, separator: true },
  { id: "copyPath", label: "Copy Path", icon: <Copy size={14} /> },
  { id: "revealInFinder", label: "Reveal in Finder", icon: <FolderOpen size={14} /> },
];

const EMPTY_MENU_ITEMS: MenuItem[] = [
  { id: "newFile", label: "New File", icon: <FilePlus size={14} /> },
  { id: "newFolder", label: "New Folder", icon: <FolderPlus size={14} /> },
];

function getMenuItems(type: ContextMenuType): MenuItem[] {
  switch (type) {
    case "file":
      return FILE_MENU_ITEMS;
    case "folder":
      return FOLDER_MENU_ITEMS;
    case "empty":
      return EMPTY_MENU_ITEMS;
  }
}

interface ContextMenuProps {
  type: ContextMenuType;
  position: ContextMenuPosition;
  onAction: (action: string) => void;
  onClose: () => void;
}

export function ContextMenu({ type, position, onAction, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const items = getMenuItems(type);

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

    // Use capture phase to catch clicks before other handlers
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
      onClose();
    },
    [onAction, onClose]
  );

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, index) => (
        <div key={item.id}>
          {item.separator && index > 0 && <div className="context-menu-separator" />}
          <div
            className="context-menu-item"
            onClick={() => handleItemClick(item.id)}
          >
            <span className="context-menu-item-icon">{item.icon}</span>
            <span className="context-menu-item-label">{item.label}</span>
            {item.shortcut && (
              <span className="context-menu-item-shortcut">{item.shortcut}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
