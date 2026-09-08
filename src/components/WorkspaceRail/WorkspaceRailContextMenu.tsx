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
 * Four things the first version got wrong, all invisible until the menu is
 * opened twice or by keyboard (audit R3 #655/#657/#658/#659):
 *
 *   - The menu is rendered CONDITIONALLY, not keyed, so opening it on another
 *     entry REUSES this component — the dismiss and the open batch into one
 *     render and nothing unmounts. Anything captured "on mount" is therefore
 *     captured once for the life of the rail. The invoker to restore focus to
 *     is a PROP the parent supplies per opening (a right-click does not focus
 *     its target in every engine, so `document.activeElement` was frequently
 *     `<body>` anyway), and the initial item focus re-runs per opening.
 *   - Tab used to walk focus out of an open menu, leaving it on screen with
 *     the keyboard somewhere else. It dismisses instead.
 *   - An action returning a promise was neither awaited nor caught. TypeScript
 *     accepts an `async` function wherever `() => void` is expected, so the
 *     type could not forbid it; the contract now says `void | Promise<void>`
 *     and the rejection is logged rather than becoming an unhandled one.
 *   - React keys were the TRANSLATED labels, so switching locale remounted
 *     every item and dropped keyboard focus. `action` is the stable id.
 *
 * @coordinates-with closeWorkspaceInstance.ts — the close action's safe path
 * @coordinates-with workspaceWindowActions.ts — duplicate / move to new window
 * @coordinates-with ./workspaceRailMenuLayout.ts — the viewport clamp
 * @module components/WorkspaceRail/WorkspaceRailContextMenu
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { workspaceError } from "@/utils/debug";
import {
  useMenuViewportClamp,
  type MenuPoint as WorkspaceRailMenuPosition,
} from "./workspaceRailMenuLayout";
import "./WorkspaceRailContextMenu.css";

export type { MenuPoint as WorkspaceRailMenuPosition } from "./workspaceRailMenuLayout";

/** An action may be async; this menu does not wait for it, but it does catch. */
type MenuAction = () => void | Promise<void>;

interface WorkspaceRailContextMenuProps {
  position: WorkspaceRailMenuPosition;
  /** Full workspace name, used for the menu's accessible label. */
  workspaceName: string;
  /**
   * The element focus returns to on dismiss — the rail entry that was
   * right-clicked. Supplied per OPENING because this component is reused
   * across openings (#655); null when the menu was opened by something with no
   * element to go back to.
   */
  invoker: HTMLElement | null;
  onClose: () => void;
  onCloseWorkspace: MenuAction;
  onDuplicate: MenuAction;
  onMoveToNewWindow: MenuAction;
}

export function WorkspaceRailContextMenu({
  position,
  workspaceName,
  invoker,
  onClose,
  onCloseWorkspace,
  onDuplicate,
  onMoveToNewWindow,
}: WorkspaceRailContextMenuProps) {
  const { t } = useTranslation("common");
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focused, setFocused] = useState(0);
  // Clamped against the viewport AND kept clamped as either changes (#656).
  const clamped = useMenuViewportClamp(position, menuRef);

  // `action` is a stable, locale-independent hook for automation (the e2e
  // rail helper closes a workspace by it); labels are translated and reorder.
  const items = [
    { action: "close", label: t("workspaceRail.menu.close"), run: onCloseWorkspace },
    { action: "duplicate", label: t("workspaceRail.menu.duplicate"), run: onDuplicate },
    { action: "move-to-new-window", label: t("workspaceRail.menu.moveToNewWindow"), run: onMoveToNewWindow },
  ] as const;

  // A new OPENING resets the roving-focus index — adjusted DURING RENDER,
  // React's own "adjust state when a prop changes" pattern, because an effect
  // that calls setState cascades a render (#1063). `position` is a fresh object
  // per right-click, so it identifies the opening; opening the menu on another
  // entry reuses this component rather than remounting it (#655).
  const [openedAt, setOpenedAt] = useState(position);
  if (openedAt !== position) {
    setOpenedAt(position);
    setFocused(0);
  }

  // Focus the first ITEM, not the container: the container's outline is
  // suppressed, so focusing it would leave no visible focus at all. A DOM
  // side effect, so it stays in an effect — and it runs per opening, not once
  // on mount, for the reason above.
  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, [position]);

  const dismiss = useCallback(() => {
    onClose();
    if (invoker?.isConnected === true) invoker.focus();
  }, [onClose, invoker]);

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
    // Tab used to walk straight out of the menu and leave it open behind the
    // keyboard (#657). Dismissing puts focus back on the rail entry, from
    // which Tab then continues normally.
    if (event.key === "Tab") {
      event.preventDefault();
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

  const run = (action: MenuAction) => () => {
    // Dismiss first so focus returns to the rail before the action mutates it.
    dismiss();
    // Not awaited — the menu is already gone and the handlers own their own
    // toasts — but a rejection is CAUGHT (#658). `() => void` accepts an async
    // function, so without this an action that throws asynchronously becomes an
    // unhandled rejection with nothing on screen to show for it.
    Promise.resolve(action()).catch((error: unknown) => {
      workspaceError("Workspace rail menu action failed:", error);
    });
  };

  return (
    <div
      ref={menuRef}
      className="vm-menu workspace-rail-menu"
      role="menu"
      aria-label={workspaceName}
      onKeyDown={onKeyDown}
      style={{ top: clamped.y, left: clamped.x }}
    >
      {items.map((item, index) => (
        <button
          key={item.action}
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
          type="button"
          role="menuitem"
          data-menu-action={item.action}
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
