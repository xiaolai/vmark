/**
 * Keyboard navigation state for the editor context menu.
 *
 * Purpose: roving focus over the flattened top-level items (skipping
 * disabled ones) plus one level of submenu — ArrowRight/Enter opens a
 * submenu and focuses its first enabled child, ArrowLeft returns to the
 * parent, Escape is two-step (submenu first, then the menu itself).
 * The one-level disabled-skip math is shared with the flat context menus
 * via `useMenuRovingFocus`'s helpers; the two-level submenu orchestration
 * below is specific to this menu.
 *
 * @coordinates-with EditorContextMenu.tsx — renders per this state
 * @coordinates-with hooks/useMenuRovingFocus.ts — findNextEnabled/findEdgeEnabled
 * @module components/Editor/EditorContextMenu/useMenuNavigation
 */

import { useCallback, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { isImeKeyEvent } from "@/utils/imeGuard";
import {
  findNextEnabled as nextEnabled,
  findEdgeEnabled as edgeEnabled,
} from "@/hooks/useMenuRovingFocus";
import type { EditorMenuAction, EditorMenuItem } from "./menuModel";

export interface MenuFocus {
  top: number;
  /** Index inside the open submenu, or null when focus is at top level. */
  sub: number | null;
}

interface UseMenuNavigationOptions {
  items: EditorMenuItem[];
  onActivate: (item: EditorMenuAction) => void;
  onClose: () => void;
}

export function useMenuNavigation({ items, onActivate, onClose }: UseMenuNavigationOptions) {
  const [focus, setFocus] = useState<MenuFocus>({ top: -1, sub: null });
  const [openSubmenu, setOpenSubmenu] = useState<number>(-1);

  const focusFirst = useCallback(() => {
    setFocus({ top: edgeEnabled(items, 1), sub: null });
    setOpenSubmenu(-1);
  }, [items]);

  const reset = useCallback(() => {
    setFocus({ top: -1, sub: null });
    setOpenSubmenu(-1);
  }, []);

  const openSubmenuAt = useCallback(
    (top: number, focusChild: boolean) => {
      const item = items[top];
      if (!item || item.kind !== "submenu" || item.disabled) return;
      setOpenSubmenu(top);
      setFocus({ top, sub: focusChild ? edgeEnabled(item.items, 1) : null });
    },
    [items]
  );

  const closeSubmenu = useCallback(() => {
    setOpenSubmenu(-1);
    setFocus((f) => ({ top: f.top, sub: null }));
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (isImeKeyEvent(event.nativeEvent)) return;
      const inSubmenu = openSubmenu >= 0 && focus.sub !== null;
      const submenuItems = openSubmenu >= 0 ? (items[openSubmenu] as { items?: EditorMenuAction[] }).items ?? [] : [];

      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp": {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          if (inSubmenu) {
            setFocus((f) => ({ top: f.top, sub: nextEnabled(submenuItems, f.sub ?? -1, direction) }));
          } else {
            setOpenSubmenu(-1);
            setFocus((f) => ({ top: nextEnabled(items, f.top, direction), sub: null }));
          }
          return;
        }
        case "Home":
        case "End": {
          event.preventDefault();
          const direction = event.key === "Home" ? 1 : -1;
          if (inSubmenu) {
            setFocus((f) => ({ top: f.top, sub: edgeEnabled(submenuItems, direction) }));
          } else {
            setFocus({ top: edgeEnabled(items, direction), sub: null });
          }
          return;
        }
        case "ArrowRight": {
          event.preventDefault();
          if (!inSubmenu) openSubmenuAt(focus.top, true);
          return;
        }
        case "ArrowLeft": {
          event.preventDefault();
          if (inSubmenu || openSubmenu >= 0) closeSubmenu();
          return;
        }
        case "Escape": {
          event.preventDefault();
          event.stopPropagation();
          if (openSubmenu >= 0) {
            closeSubmenu();
          } else {
            onClose();
          }
          return;
        }
        case "Tab": {
          event.preventDefault();
          onClose();
          return;
        }
        case "Enter":
        case " ": {
          event.preventDefault();
          if (inSubmenu) {
            const child = submenuItems[focus.sub ?? -1];
            if (child && !child.disabled) onActivate(child);
            return;
          }
          const item = items[focus.top];
          if (!item || item.disabled) return;
          if (item.kind === "submenu") {
            openSubmenuAt(focus.top, true);
          } else {
            onActivate(item);
          }
          return;
        }
      }
    },
    [items, focus, openSubmenu, onActivate, onClose, openSubmenuAt, closeSubmenu]
  );

  return {
    focus,
    openSubmenu,
    setFocus,
    focusFirst,
    reset,
    openSubmenuAt,
    closeSubmenu,
    handleKeyDown,
  };
}
