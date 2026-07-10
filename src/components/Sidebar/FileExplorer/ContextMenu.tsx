/**
 * ContextMenu
 *
 * Purpose: macOS-style right-click context menu for the file explorer. Shows different
 * actions depending on whether the user clicked a file, folder, or empty area.
 * All user-visible labels are translated via the "sidebar" i18n namespace.
 *
 * User interactions:
 *   - Arrow keys navigate menu items; Enter/Space activates
 *   - Escape or click-outside closes the menu
 *   - Tab key closes the menu
 * Automatically adjusts position to stay within viewport bounds.
 *
 * @coordinates-with FileExplorer.tsx — rendered as a child when contextMenu.visible is true
 * @coordinates-with useExplorerOperations.ts — file operations triggered by menu actions
 * @module components/Sidebar/FileExplorer/ContextMenu
 */
import {
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import {
  FileText,
  FolderPlus,
  FilePlus,
  Pencil,
  Trash2,
  Copy,
  FolderOpen,
  FolderInput,
} from "lucide-react";
import { useDismissOnOutsideOrEscape } from "@/hooks/useDismissOnOutsideOrEscape";
import { useMenuRovingFocus } from "@/hooks/useMenuRovingFocus";
import "./ContextMenu.css";

/** Determines which menu items are shown: file actions, folder actions, or empty-area actions. */
export type ContextMenuType = "file" | "folder" | "empty";

/** Viewport coordinates for context menu placement. */
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
  /** Unused today, but the shared roving-focus hook skips disabled items. */
  disabled?: boolean;
}

// Build menu items using translated labels
function buildFileMenuItems(labels: Record<string, string>): MenuItem[] {
  return [
    { id: "open", label: labels.open, icon: <FileText size={14} /> },
    { id: "rename", label: labels.rename, icon: <Pencil size={14} />, separator: true },
    { id: "duplicate", label: labels.duplicate, icon: <Copy size={14} /> },
    { id: "moveTo", label: labels.moveTo, icon: <FolderInput size={14} /> },
    { id: "delete", label: labels.delete, icon: <Trash2 size={14} />, separator: true },
    { id: "copyPath", label: labels.copyPath, icon: <Copy size={14} /> },
    { id: "revealInFinder", label: labels.revealLabel, icon: <FolderOpen size={14} /> },
  ];
}

function buildFolderMenuItems(labels: Record<string, string>): MenuItem[] {
  return [
    { id: "newFile", label: labels.newFile, icon: <FilePlus size={14} /> },
    { id: "newFolder", label: labels.newFolder, icon: <FolderPlus size={14} />, separator: true },
    { id: "rename", label: labels.rename, icon: <Pencil size={14} /> },
    { id: "delete", label: labels.delete, icon: <Trash2 size={14} />, separator: true },
    { id: "copyPath", label: labels.copyPath, icon: <Copy size={14} /> },
    { id: "revealInFinder", label: labels.revealLabel, icon: <FolderOpen size={14} /> },
  ];
}

function buildEmptyMenuItems(labels: Record<string, string>): MenuItem[] {
  return [
    { id: "newFile", label: labels.newFile, icon: <FilePlus size={14} /> },
    { id: "newFolder", label: labels.newFolder, icon: <FolderPlus size={14} /> },
  ];
}

function getMenuItems(type: ContextMenuType, labels: Record<string, string>): MenuItem[] {
  switch (type) {
    case "file":
      return buildFileMenuItems(labels);
    case "folder":
      return buildFolderMenuItems(labels);
    case "empty":
      return buildEmptyMenuItems(labels);
  }
}

/** Platform-appropriate translation key for the "reveal in file manager" action. */
function revealLabelKey(): string {
  const platform = typeof navigator !== "undefined" ? navigator.platform.toLowerCase() : "";
  if (platform.includes("mac")) return "contextMenu.revealInFinder";
  if (platform.includes("win")) return "contextMenu.showInExplorer";
  return "contextMenu.showInFileManager";
}

interface ContextMenuProps {
  type: ContextMenuType;
  position: ContextMenuPosition;
  onAction: (action: string) => void;
  onClose: () => void;
}

/** Renders a macOS-style context menu with viewport-aware positioning and keyboard navigation. */
export function ContextMenu({ type, position, onAction, onClose }: ContextMenuProps) {
  const { t } = useTranslation("sidebar");
  const menuRef = useRef<HTMLDivElement>(null);

  // Resolve platform-appropriate "reveal in file manager" label via translation keys.
  // The React Compiler auto-memoizes the component, so no manual useMemo is needed —
  // and a useMemo reading the `navigator` global can't be preserved by the compiler (#1063).
  const revealLabel = t(revealLabelKey());

  const menuLabels = useMemo(() => ({
    open: t("contextMenu.open"),
    rename: t("contextMenu.rename"),
    duplicate: t("contextMenu.duplicate"),
    moveTo: t("contextMenu.moveTo"),
    delete: t("contextMenu.delete"),
    copyPath: t("contextMenu.copyPath"),
    newFile: t("newFile"),
    newFolder: t("newFolder"),
    revealLabel,
  }), [t, revealLabel]);

  const items = getMenuItems(type, menuLabels);

  // Click-outside only; Escape/Tab are owned by the roving hook.
  useDismissOnOutsideOrEscape(true, menuRef, onClose, { escape: false });

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

  const { handleKeyDown, registerItem, itemProps } = useMenuRovingFocus<MenuItem>({
    items,
    onActivate: (item) => handleItemClick(item.id),
    onDismiss: onClose,
    // A second right-click can swap the item set (file → folder → empty)
    // while this instance stays mounted; re-seed focus so it stays inside
    // the menu and Escape keeps working.
    resetKey: type,
  });

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label={t("contextMenu.ariaLabel")}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, index) => (
        <div key={item.id}>
          {item.separator && index > 0 && <div className="context-menu-separator" />}
          <button
            ref={(node) => registerItem(index, node)}
            type="button"
            role="menuitem"
            className="context-menu-item"
            onClick={() => handleItemClick(item.id)}
            {...itemProps(index)}
          >
            <span className="context-menu-item-icon">{item.icon}</span>
            <span className="context-menu-item-label">{item.label}</span>
            {item.shortcut && (
              <span className="context-menu-item-shortcut">{item.shortcut}</span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
