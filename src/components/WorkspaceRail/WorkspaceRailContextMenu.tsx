/**
 * Right-click menu for a workspace rail entry.
 *
 * The rail previously exposed exactly one action — a hover-only duplicate badge
 * — while its two most consequential operations were unreachable or hazardous:
 * there was NO way to close a workspace at all, and moving one to a new window
 * was only possible by dragging its icon outside the window, an undiscoverable
 * gesture that is easy to trigger by accident and has no confirmation.
 *
 * Follows the context-menu pattern in .claude/rules/32-component-patterns.md
 * (fixed positioning, `--z-context-menu`, Escape and click-outside dismissal,
 * visible focus per rule 33).
 *
 * @coordinates-with closeWorkspaceInstance.ts — the close action's safe path
 * @coordinates-with workspaceWindowActions.ts — duplicate / move to new window
 * @module components/WorkspaceRail/WorkspaceRailContextMenu
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import "./WorkspaceRailContextMenu.css";

export interface WorkspaceRailMenuPosition {
  x: number;
  y: number;
}

interface WorkspaceRailContextMenuProps {
  position: WorkspaceRailMenuPosition;
  /** Full workspace name, used for the menu's accessible label. */
  workspaceName: string;
  onClose: () => void;
  onCloseWorkspace: () => void;
  onDuplicate: () => void;
  onMoveToNewWindow: () => void;
}

export function WorkspaceRailContextMenu({
  position,
  workspaceName,
  onClose,
  onCloseWorkspace,
  onDuplicate,
  onMoveToNewWindow,
}: WorkspaceRailContextMenuProps) {
  const { t } = useTranslation("common");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus the menu so Escape works immediately and focus is never left on
    // the rail button behind an open menu.
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div
      ref={menuRef}
      className="workspace-rail-menu"
      role="menu"
      tabIndex={-1}
      aria-label={workspaceName}
      style={{ top: position.y, left: position.x }}
    >
      <button
        type="button"
        role="menuitem"
        className="workspace-rail-menu__item"
        onClick={run(onCloseWorkspace)}
      >
        {t("workspaceRail.menu.close")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="workspace-rail-menu__item"
        onClick={run(onDuplicate)}
      >
        {t("workspaceRail.menu.duplicate")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="workspace-rail-menu__item"
        onClick={run(onMoveToNewWindow)}
      >
        {t("workspaceRail.menu.moveToNewWindow")}
      </button>
    </div>
  );
}
