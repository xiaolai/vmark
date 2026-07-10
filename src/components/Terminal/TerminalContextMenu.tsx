/**
 * TerminalContextMenu
 *
 * Purpose: Right-click context menu for the terminal — copy, paste,
 * select all, clear, and reset-display operations.
 *
 * User interactions:
 *   - Arrow keys navigate menu items (disabled items are skipped);
 *     Home/End jump to the first/last enabled item.
 *   - Enter/Space activates the focused item.
 *   - Escape, Tab, or click-outside closes the menu.
 *
 * Accessibility:
 *   - Container is role="menu" with an aria-label; items are
 *     role="menuitem" buttons using a roving tabindex (focused item
 *     tabIndex=0, others -1). The first enabled item is focused on open.
 *
 * Key decisions:
 *   - Copy is disabled when no text is selected (greyed out via the shared
 *     .context-menu-item:disabled rule).
 *   - Paste routes through `term.paste()` so xterm applies bracketed-paste
 *     wrapping when the app enabled it (multiline paste won't auto-execute, G2).
 *   - Reuses the FileExplorer ContextMenu.css for consistent macOS-style
 *     appearance across all context menus.
 *   - Viewport adjustment keeps the menu from overflowing screen edges.
 *   - After any action, focus returns to the terminal.
 *   - "Reset Display" (#856) clears the WebGL texture atlas and re-paints
 *     the viewport. Hidden when the parent does not provide an action,
 *     so the menu stays minimal in non-terminal contexts.
 *
 * @coordinates-with TerminalPanel.tsx — rendered when right-click occurs in terminal area
 * @coordinates-with createTerminalInstance.ts — provides resetDisplay()
 * @module components/Terminal/TerminalContextMenu
 */
import { useLayoutEffect, useRef, useState, useCallback } from "react";
import { Copy, CopyMinus, ClipboardPaste, Square, Trash2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Terminal } from "@xterm/xterm";
import { useDismissOnOutsideOrEscape } from "@/hooks/useDismissOnOutsideOrEscape";
import { useMenuRovingFocus } from "@/hooks/useMenuRovingFocus";
import { clipboardWarn } from "@/utils/debug";
import { unwrapTerminalSelection } from "./unwrapSelection";
import "../Sidebar/FileExplorer/ContextMenu.css";
import { errorMessage } from "@/utils/errorMessage";

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  separatorBefore?: boolean;
}

interface TerminalContextMenuProps {
  position: { x: number; y: number };
  term: Terminal;
  /** Optional: clears the WebGL texture atlas and re-paints the viewport (#856). */
  onResetDisplay?: () => void;
  onClose: () => void;
}

/** Renders a right-click context menu for the terminal (copy, paste, select all, clear, reset display). */
export function TerminalContextMenu({
  position,
  term,
  onResetDisplay,
  onClose,
}: TerminalContextMenuProps) {
  const { t } = useTranslation("statusbar");
  const menuRef = useRef<HTMLDivElement>(null);
  // Snapshot selection state at open time so the Copy items keep a stable
  // enabled/disabled state for the menu's lifetime — arrowing around (which
  // re-renders) must not flip them. The action handler still checks
  // `term.hasSelection()` live, so a selection cleared after open is caught.
  const [hasSelection] = useState(() => term.hasSelection());

  const items: MenuItem[] = [
    { id: "copy", label: t("terminal.contextMenu.copy"), icon: <Copy size={14} />, disabled: !hasSelection },
    { id: "copyUnwrapped", label: t("terminal.contextMenu.copyUnwrapped"), icon: <CopyMinus size={14} />, disabled: !hasSelection },
    { id: "paste", label: t("terminal.contextMenu.paste"), icon: <ClipboardPaste size={14} /> },
    { id: "selectAll", label: t("terminal.contextMenu.selectAll"), icon: <Square size={14} /> },
    { id: "clear", label: t("terminal.contextMenu.clear"), icon: <Trash2 size={14} />, separatorBefore: true },
    ...(onResetDisplay
      ? [{ id: "resetDisplay", label: t("terminal.contextMenu.resetDisplay"), icon: <RefreshCw size={14} /> } satisfies MenuItem]
      : []),
  ];

  // Close and return focus to the terminal — used by keyboard dismissal
  // (Escape/Tab) and after every action, so keyboard users never lose
  // terminal input. Click-outside does NOT refocus (the user clicked
  // elsewhere on purpose), so it uses the bare `onClose`.
  const closeAndFocus = useCallback(() => {
    onClose();
    term.focus();
  }, [onClose, term]);

  // Click-outside only (capture phase); Escape is owned by the roving hook
  // so it can refocus the terminal — unlike an outside click.
  useDismissOnOutsideOrEscape(true, menuRef, onClose, { escape: false });

  // Adjust position to keep in viewport (useLayoutEffect to avoid flicker)
  useLayoutEffect(() => {
    /* v8 ignore next -- @preserve menuRef guard: ref is always set before layout effect runs */
    if (!menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    let x = position.x;
    let y = position.y;
    if (x + rect.width > window.innerWidth - 10) x = window.innerWidth - rect.width - 10;
    if (y + rect.height > window.innerHeight - 10) y = window.innerHeight - rect.height - 10;
    // Floor at a 10px viewport inset — a menu wider/taller than the viewport
    // (small windows, very long localized labels) would otherwise compute a
    // negative offset, parking the top-left corner off-screen and putting
    // the first item out of reach. (Audit Round B M1.)
    x = Math.max(10, x);
    y = Math.max(10, y);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }, [position]);

  const handleAction = useCallback(
    async (id: string) => {
      // Always close the menu and restore focus — even when a clipboard
      // call rejects (permission denial, headless test env). Without the
      // finally, a thrown writeText/readText would leave the menu open
      // and focus parked on whatever stole it. (Audit finding M1.)
      try {
        switch (id) {
          case "copy":
            if (term.hasSelection()) {
              await writeText(term.getSelection().trimEnd());
              term.clearSelection();
            }
            break;
          case "copyUnwrapped":
            // Collapse the program's display-width line breaks back into
            // logical paragraphs before copying (#950). Opt-in: the user
            // chose this selection knowing it's one flow.
            if (term.hasSelection()) {
              await writeText(unwrapTerminalSelection(term.getSelection()));
              term.clearSelection();
            }
            break;
          case "paste": {
            // Route through term.paste so xterm wraps it per bracketed-paste
            // mode (multiline paste won't auto-execute) — G2.
            const text = await readText();
            if (text) {
              term.paste(text);
            }
            break;
          }
          case "selectAll":
            term.selectAll();
            break;
          case "clear":
            term.clear();
            break;
          case "resetDisplay":
            onResetDisplay?.();
            break;
        }
      } catch (err) {
        // Log clipboard / PTY failures via the project's clipboard channel
        // (mirrors setupCopyOnSelect's failure path) so the catch absorbs
        // the rejection — otherwise the unhandled-rejection guard would
        // fire and the test runner would surface the noise. (Audit Round A H3.)
        clipboardWarn(
          "Terminal context-menu action failed:",
          errorMessage(err),
        );
      } finally {
        onClose();
        term.focus();
      }
    },
    [term, onResetDisplay, onClose],
  );

  const { handleKeyDown, registerItem, itemProps } = useMenuRovingFocus<MenuItem>({
    items,
    onActivate: (item) => void handleAction(item.id),
    onDismiss: closeAndFocus,
  });

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label={t("terminal.contextMenu.ariaLabel")}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, index) => (
        <div key={item.id}>
          {item.separatorBefore && <div className="context-menu-separator" />}
          <button
            ref={(node) => registerItem(index, node)}
            type="button"
            role="menuitem"
            className="context-menu-item"
            disabled={item.disabled}
            onClick={() => handleAction(item.id)}
            {...itemProps(index)}
          >
            <span className="context-menu-item-icon">{item.icon}</span>
            <span className="context-menu-item-label">{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
