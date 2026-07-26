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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./WorkspaceRailContextMenu.css";

/** Keep the menu this far from the viewport edge when clamping. */
const VIEWPORT_MARGIN = 8;

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
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focused, setFocused] = useState(0);
  const [clamped, setClamped] = useState(position);
  // Restore focus here on dismiss — otherwise Escape leaves focus on <body>
  // and a keyboard user loses their place in the rail.
  const invokerRef = useRef<Element | null>(
    typeof document === "undefined" ? null : document.activeElement,
  );

  const items = [
    { label: t("workspaceRail.menu.close"), run: onCloseWorkspace },
    { label: t("workspaceRail.menu.duplicate"), run: onDuplicate },
    { label: t("workspaceRail.menu.moveToNewWindow"), run: onMoveToNewWindow },
  ];

  // Clamp against the viewport before paint. Raw clientX/clientY puts a menu
  // opened near the bottom or right edge partly off-screen.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const maxX = globalThis.innerWidth - width - VIEWPORT_MARGIN;
    const maxY = globalThis.innerHeight - height - VIEWPORT_MARGIN;
    setClamped({
      x: Math.max(VIEWPORT_MARGIN, Math.min(position.x, maxX)),
      y: Math.max(VIEWPORT_MARGIN, Math.min(position.y, maxY)),
    });
  }, [position]);

  // Focus the first ITEM, not the container: the container's outline is
  // suppressed, so focusing it would leave no visible focus at all.
  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  const dismiss = useCallback(() => {
    const invoker = invokerRef.current;
    onClose();
    if (invoker instanceof HTMLElement && invoker.isConnected) invoker.focus();
  }, [onClose]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [dismiss]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      dismiss();
      return;
    }
    // Roving focus — the keyboard contract a role="menu" is expected to honour.
    const move = (next: number) => {
      event.preventDefault();
      setFocused(next);
      itemRefs.current[next]?.focus();
    };
    if (event.key === "ArrowDown") move((focused + 1) % items.length);
    else if (event.key === "ArrowUp") move((focused - 1 + items.length) % items.length);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
  };

  const run = (action: () => void) => () => {
    // Dismiss first so focus returns to the rail before the action mutates it.
    dismiss();
    action();
  };

  return (
    <div
      ref={menuRef}
      className="workspace-rail-menu"
      role="menu"
      aria-label={workspaceName}
      onKeyDown={onKeyDown}
      style={{ top: clamped.y, left: clamped.x }}
    >
      {items.map((item, index) => (
        <button
          key={item.label}
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
          type="button"
          role="menuitem"
          className="workspace-rail-menu__item"
          tabIndex={index === focused ? 0 : -1}
          onFocus={() => setFocused(index)}
          onClick={run(item.run)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
