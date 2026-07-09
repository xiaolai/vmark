/**
 * Editor context-menu item renderers — action buttons and submenu rows.
 *
 * Purpose: presentational split from EditorContextMenu.tsx (which owns
 * state, positioning, and dismissal) so both files stay under the ~300
 * line guideline. Everything here is a pure function of props; roving
 * focus and activation are driven by the container through callbacks.
 *
 * @coordinates-with EditorContextMenu.tsx — supplies nav state + refs
 * @module components/Editor/EditorContextMenu/MenuItems
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Bold, Check, ChevronRight, ClipboardPaste, Code, Copy, Heading, Italic,
  Link, List, Scissors, SquareCode, Strikethrough, TextQuote, TextSelect, Unlink,
  type LucideIcon,
} from "lucide-react";
import type { EditorMenuAction, EditorMenuItem } from "./menuModel";
import type { MenuFocus } from "./useMenuNavigation";

const ICONS: Record<string, LucideIcon> = {
  cut: Scissors,
  copy: Copy,
  paste: ClipboardPaste,
  selectAll: TextSelect,
  bold: Bold,
  italic: Italic,
  strikethrough: Strikethrough,
  code: Code,
  heading: Heading,
  list: List,
  blockquote: TextQuote,
  codeBlock: SquareCode,
  link: Link,
  unlink: Unlink,
};

function ItemGlyph({ item }: { item: EditorMenuAction }) {
  if (item.checked) return <Check size={14} aria-hidden />;
  const Icon = item.iconId ? ICONS[item.iconId] : undefined;
  return Icon ? <Icon size={14} aria-hidden /> : null;
}

export interface MenuItemCallbacks {
  t: (key: string) => string;
  shortcutFor: (item: EditorMenuAction) => string;
  activate: (item: EditorMenuAction) => void;
  /** Ref-callback registrar owned by the container (refs never cross
   *  component props as ref objects — react-hooks/refs). */
  registerItemRef: (refKey: string, node: HTMLButtonElement | null) => void;
  registerSubmenuEl: (node: HTMLDivElement | null) => void;
  focus: MenuFocus;
  openSubmenu: number;
  submenuFlipped: boolean;
  /** Vertical shift (px) keeping the submenu inside the window. */
  submenuOffsetY: number;
  setFocus: (focus: MenuFocus) => void;
  openSubmenuAt: (top: number, focusChild: boolean) => void;
  closeSubmenu: () => void;
  handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

function ActionButton({
  item,
  refKey,
  cb,
  extraProps,
}: {
  item: EditorMenuAction;
  refKey: string;
  cb: MenuItemCallbacks;
  extraProps: object;
}) {
  const shortcut = cb.shortcutFor(item);
  return (
    <button
      key={item.id}
      ref={(node) => cb.registerItemRef(refKey, node)}
      type="button"
      role={item.checkable ? "menuitemcheckbox" : "menuitem"}
      aria-checked={item.checkable ? item.checked : undefined}
      className="context-menu-item"
      disabled={item.disabled}
      onClick={() => cb.activate(item)}
      {...extraProps}
    >
      <span className="context-menu-item-icon"><ItemGlyph item={item} /></span>
      <span className="context-menu-item-label">{cb.t(item.labelKey)}</span>
      {shortcut && <span className="context-menu-item-shortcut">{shortcut}</span>}
    </button>
  );
}

/** One top-level row: a plain action, or a submenu parent + its panel. */
export function MenuTopItem({
  item,
  topIndex,
  cb,
}: {
  item: EditorMenuItem;
  topIndex: number;
  cb: MenuItemCallbacks;
}) {
  if (item.kind === "action") {
    return (
      <ActionButton
        item={item}
        refKey={`top:${topIndex}`}
        cb={cb}
        extraProps={{
          tabIndex: cb.focus.top === topIndex && cb.focus.sub === null ? 0 : -1,
          onMouseEnter: () => {
            cb.closeSubmenu();
            cb.setFocus({ top: topIndex, sub: null });
          },
          // Keep roving state in sync when focus arrives outside the
          // roving effect (e.g. programmatic focus).
          onFocus: () => cb.setFocus({ top: topIndex, sub: null }),
        }}
      />
    );
  }

  const expanded = cb.openSubmenu === topIndex;
  const ParentIcon = item.iconId ? ICONS[item.iconId] : undefined;
  return (
    <div className="editor-context-menu-subwrap">
      <button
        ref={(node) => cb.registerItemRef(`top:${topIndex}`, node)}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={expanded}
        className="context-menu-item"
        disabled={item.disabled}
        tabIndex={cb.focus.top === topIndex && cb.focus.sub === null ? 0 : -1}
        onMouseEnter={() => cb.openSubmenuAt(topIndex, false)}
        onFocus={() => {
          if (cb.focus.top !== topIndex) cb.setFocus({ top: topIndex, sub: null });
        }}
        onClick={() => cb.openSubmenuAt(topIndex, true)}
      >
        <span className="context-menu-item-icon">
          {ParentIcon ? <ParentIcon size={14} aria-hidden /> : null}
        </span>
        <span className="context-menu-item-label">{cb.t(item.labelKey)}</span>
        <span className="editor-context-menu-chevron"><ChevronRight size={14} aria-hidden /></span>
      </button>
      {expanded && (
        <div
          ref={(node) => cb.registerSubmenuEl(node)}
          role="menu"
          aria-label={cb.t(item.labelKey)}
          className={`context-menu editor-context-submenu${cb.submenuFlipped ? " editor-context-submenu--flip" : ""}`}
          style={cb.submenuOffsetY !== 0 ? { transform: `translateY(${cb.submenuOffsetY}px)` } : undefined}
        >
          {item.items.map((child, childIndex) => (
            <ActionButton
              key={child.id}
              item={child}
              refKey={`sub:${topIndex}:${childIndex}`}
              cb={cb}
              extraProps={{
                tabIndex:
                  cb.focus.top === topIndex && cb.focus.sub === childIndex ? 0 : -1,
                onMouseEnter: () => cb.setFocus({ top: topIndex, sub: childIndex }),
                onFocus: () => cb.setFocus({ top: topIndex, sub: childIndex }),
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
