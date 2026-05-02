/**
 * TerminalContextMenu
 *
 * Purpose: Right-click context menu for the terminal — copy, paste,
 * select all, clear, and reset-display operations.
 *
 * Key decisions:
 *   - Copy is disabled when no text is selected (greyed out).
 *   - Paste writes directly to the PTY (not the terminal buffer) so the
 *     shell receives the input as if typed.
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
import { useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { Copy, ClipboardPaste, Square, Trash2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Terminal } from "@xterm/xterm";
import type { IPty } from "@/lib/pty";
import { isImeKeyEvent } from "@/utils/imeGuard";
import "../Sidebar/FileExplorer/ContextMenu.css";

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
  ptyRef: React.RefObject<IPty | null>;
  /** Optional: clears the WebGL texture atlas and re-paints the viewport (#856). */
  onResetDisplay?: () => void;
  onClose: () => void;
}

/** Renders a right-click context menu for the terminal (copy, paste, select all, clear, reset display). */
export function TerminalContextMenu({
  position,
  term,
  ptyRef,
  onResetDisplay,
  onClose,
}: TerminalContextMenuProps) {
  const { t } = useTranslation("statusbar");
  const menuRef = useRef<HTMLDivElement>(null);
  const hasSelection = term.hasSelection();

  const items: MenuItem[] = [
    { id: "copy", label: t("terminal.contextMenu.copy"), icon: <Copy size={14} />, disabled: !hasSelection },
    { id: "paste", label: t("terminal.contextMenu.paste"), icon: <ClipboardPaste size={14} /> },
    { id: "selectAll", label: t("terminal.contextMenu.selectAll"), icon: <Square size={14} /> },
    { id: "clear", label: t("terminal.contextMenu.clear"), icon: <Trash2 size={14} />, separatorBefore: true },
    ...(onResetDisplay
      ? [{ id: "resetDisplay", label: t("terminal.contextMenu.resetDisplay"), icon: <RefreshCw size={14} /> } satisfies MenuItem]
      : []),
  ];

  // Close on click outside (capture phase) and Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (isImeKeyEvent(e)) return;
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

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
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }, [position]);

  const handleAction = useCallback(
    async (id: string) => {
      switch (id) {
        case "copy":
          if (term.hasSelection()) {
            await writeText(term.getSelection().trimEnd());
            term.clearSelection();
          }
          break;
        case "paste": {
          const text = await readText();
          if (text && ptyRef.current) {
            ptyRef.current.write(text);
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
      onClose();
      term.focus();
    },
    [term, ptyRef, onResetDisplay, onClose],
  );

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore && <div className="context-menu-separator" />}
          <div
            className="context-menu-item"
            style={{ opacity: item.disabled ? 0.4 : 1, pointerEvents: item.disabled ? "none" : "auto" }}
            onClick={() => handleAction(item.id)}
          >
            <span className="context-menu-item-icon">{item.icon}</span>
            <span className="context-menu-item-label">{item.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
