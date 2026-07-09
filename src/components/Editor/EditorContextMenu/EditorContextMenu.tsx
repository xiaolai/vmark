/**
 * Editor Context Menu — right-click menu for the editing surfaces.
 *
 * Singleton driven by the popupStore `editorContextMenu` slice (opened by
 * the per-surface triggers with a position + state snapshot). Renders the
 * pure model from `buildEditorContextMenu`; activation routes through
 * `runMenuAction` (adapters / native clipboard bridge / link commands).
 *
 * User interactions:
 *   - Arrow keys navigate (disabled items skipped); Home/End jump.
 *   - ArrowRight/Enter opens a submenu; ArrowLeft returns to the parent.
 *   - Escape is two-step (submenu, then menu); Tab closes.
 *   - Closes on outside click, scroll, window resize, and window blur.
 *   - Keyboard closes refocus the editor; outside clicks do not steal
 *     focus back.
 *
 * Accessibility: role="menu" container; checkable items are
 * role="menuitemcheckbox" with aria-checked; submenu parents carry
 * aria-haspopup/aria-expanded; roving tabindex.
 *
 * @coordinates-with menuModel.ts — the section/item model
 * @coordinates-with runMenuAction.ts — item execution
 * @module components/Editor/EditorContextMenu/EditorContextMenu
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePopupStore } from "@/stores/popupStore";
import { useShortcutsStore, formatKeyForDisplay } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { useDismissOnOutsideOrEscape } from "@/hooks/useDismissOnOutsideOrEscape";
import "@/components/Sidebar/FileExplorer/ContextMenu.css";
import "./editor-context-menu.css";
import { buildEditorContextMenu, type EditorMenuAction } from "./menuModel";
import { runEditorMenuItem } from "./runMenuAction";
import { contextMenuError } from "@/utils/debug";
import { focusEditorSurface } from "./clipboardBridge";
import { useMenuNavigation } from "./useMenuNavigation";
import { MenuTopItem, type MenuItemCallbacks } from "./MenuItems";

const VIEWPORT_INSET = 10;

export function EditorContextMenu() {
  const { t } = useTranslation("editor");
  const isOpen = usePopupStore((s) => s.editorContextMenu.isOpen);
  const position = usePopupStore((s) => s.editorContextMenu.position);
  const snapshot = usePopupStore((s) => s.editorContextMenu.snapshot);
  // Subscribed so an open menu re-renders if bindings change; values are
  // read via getShortcut below.
  useShortcutsStore((s) => s.customBindings);

  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const submenuRef = useRef<HTMLDivElement>(null);
  const [submenuFlipped, setSubmenuFlipped] = useState(false);
  const [submenuOffsetY, setSubmenuOffsetY] = useState(0);
  // Mirrors submenuOffsetY for the measuring effect (state deps would
  // retrigger measurement; the ref backs the applied shift out of rects).
  const submenuOffsetRef = useRef(0);

  const sections = useMemo(
    () => (snapshot ? buildEditorContextMenu(snapshot) : []),
    [snapshot]
  );
  const topItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  const closeOnly = useCallback(() => {
    usePopupStore.getState().editorContextCloseMenu();
  }, []);

  const closeAndRefocus = useCallback(() => {
    const surface = usePopupStore.getState().editorContextMenu.snapshot?.surface;
    usePopupStore.getState().editorContextCloseMenu();
    if (surface) focusEditorSurface(surface);
  }, []);

  const activate = useCallback(
    (item: EditorMenuAction) => {
      const snap = usePopupStore.getState().editorContextMenu.snapshot;
      usePopupStore.getState().editorContextCloseMenu();
      /* v8 ignore next -- @preserve reason: activation is unreachable while closed; defensive */
      if (!snap) return;
      runEditorMenuItem(item.run, snap).catch((error) => {
        contextMenuError(`menu item ${item.id} failed:`, error);
      });
    },
    []
  );

  const nav = useMenuNavigation({ items: topItems, onActivate: activate, onClose: closeAndRefocus });
  const { focusFirst, reset } = nav;

  useDismissOnOutsideOrEscape(isOpen, menuRef, closeOnly, { escape: false });

  // Close when the active tab changes (keyboard tab switching bypasses
  // the click-outside dismissal) — the snapshot targets the old tab's
  // surface. Reads open-state imperatively so this effect only reacts to
  // tab identity, not to open/close transitions. Subscribes to tabStore
  // directly (not useActiveTabId) so the singleton has no WindowProvider
  // dependency.
  const activeTabId = useTabStore((s) => s.activeTabId[getCurrentWindowLabel()] ?? null);
  useEffect(() => {
    if (usePopupStore.getState().editorContextMenu.isOpen) closeOnly();
  }, [activeTabId, closeOnly]);

  // Close on scroll (outside the menu), window resize, and window blur.
  useEffect(() => {
    if (!isOpen) return;
    const onScroll = (event: Event) => {
      /* v8 ignore next -- @preserve reason: menus have no internal scroll today; guard for future overflow */
      if (menuRef.current?.contains(event.target as Node)) return;
      closeOnly();
    };
    const onViewportChange = () => closeOnly();
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("blur", onViewportChange);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("blur", onViewportChange);
    };
  }, [isOpen, closeOnly]);

  // Seed roving focus on open; clear on close.
  // Legitimate setState-in-effect: reacts to the open/close transition (#1063).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen) {
      focusFirst();
    } else {
      reset();
      setSubmenuFlipped(false);
      setSubmenuOffsetY(0);
    }
  }, [isOpen, focusFirst, reset]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keep viewport clamping in sync with the reported position.
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu || !position) return;
    const rect = menu.getBoundingClientRect();
    const x = Math.min(position.x, window.innerWidth - rect.width - VIEWPORT_INSET);
    const y = Math.min(position.y, window.innerHeight - rect.height - VIEWPORT_INSET);
    menu.style.left = `${Math.max(VIEWPORT_INSET, x)}px`;
    menu.style.top = `${Math.max(VIEWPORT_INSET, y)}px`;
  }, [position, isOpen]);

  // Keep the submenu inside the window: flip horizontally when its right
  // edge would overflow, shift it up when its bottom would. Measures the
  // RENDERED rect and backs out the currently applied shift (offsetRef),
  // so it never assumes the CSS anchor and never inherits a stale offset
  // when switching between submenus.
  // Legitimate setState-in-effect: depends on post-render geometry (#1063).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (nav.openSubmenu < 0) {
      setSubmenuFlipped(false);
      submenuOffsetRef.current = 0;
      setSubmenuOffsetY(0);
      return;
    }
    const submenu = submenuRef.current;
    const parent = itemRefs.current.get(`top:${nav.openSubmenu}`);
    if (!submenu || !parent) return;
    const parentRect = parent.getBoundingClientRect();
    // Rect dimensions, not offsetWidth/Height: rects share the same space
    // as parentRect and window.innerWidth/Height, and a translateY on the
    // panel doesn't change its rect size.
    const rect = submenu.getBoundingClientRect();

    setSubmenuFlipped(parentRect.right + rect.width > window.innerWidth - VIEWPORT_INSET);

    const baseTop = rect.top - submenuOffsetRef.current;
    let offset = 0;
    const maxBottom = window.innerHeight - VIEWPORT_INSET;
    /* v8 ignore next 2 -- @preserve reason: jsdom reports zero sizes; the clamp branches are covered by the mocked-geometry test and live E2E */
    if (baseTop + rect.height > maxBottom) offset = maxBottom - (baseTop + rect.height);
    if (baseTop + offset < VIEWPORT_INSET) offset = VIEWPORT_INSET - baseTop;
    submenuOffsetRef.current = Math.round(offset);
    setSubmenuOffsetY(submenuOffsetRef.current);
  }, [nav.openSubmenu]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Move DOM focus to the roving-focus target.
  useEffect(() => {
    if (!isOpen) return;
    const { top, sub } = nav.focus;
    if (top < 0) return;
    const key = sub === null ? `top:${top}` : `sub:${top}:${sub}`;
    itemRefs.current.get(key)?.focus();
  }, [isOpen, nav.focus]);

  const shortcutFor = useCallback((item: EditorMenuAction): string => {
    if (item.shortcutKey) return formatKeyForDisplay(item.shortcutKey);
    if (item.shortcutId) {
      return formatKeyForDisplay(useShortcutsStore.getState().getShortcut(item.shortcutId));
    }
    return "";
  }, []);

  const registerItemRef = useCallback((refKey: string, node: HTMLButtonElement | null) => {
    if (node) itemRefs.current.set(refKey, node);
    else itemRefs.current.delete(refKey);
  }, []);

  const registerSubmenuEl = useCallback((node: HTMLDivElement | null) => {
    submenuRef.current = node;
  }, []);

  if (!isOpen || !position || !snapshot) return null;

  const itemCallbacks: MenuItemCallbacks = {
    t,
    shortcutFor,
    activate,
    registerItemRef,
    registerSubmenuEl,
    focus: nav.focus,
    openSubmenu: nav.openSubmenu,
    submenuFlipped,
    submenuOffsetY,
    setFocus: nav.setFocus,
    openSubmenuAt: nav.openSubmenuAt,
    closeSubmenu: nav.closeSubmenu,
    handleKeyDown: nav.handleKeyDown,
  };

  let runningIndex = 0;
  return (
    <div
      ref={menuRef}
      className="context-menu editor-context-menu"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label={t("contextMenu.ariaLabel")}
      onKeyDown={nav.handleKeyDown}
    >
      {sections.map((section, sectionIndex) => (
        <Fragment key={section.id}>
          {sectionIndex > 0 && <div className="context-menu-separator" />}
          {section.items.map((item) => (
            <MenuTopItem key={item.id} item={item} topIndex={runningIndex++} cb={itemCallbacks} />
          ))}
        </Fragment>
      ))}
    </div>
  );
}
