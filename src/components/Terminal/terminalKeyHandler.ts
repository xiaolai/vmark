/**
 * terminalKeyHandler
 *
 * Purpose: Custom key event handler for the integrated terminal. Intercepts
 * Cmd/Ctrl shortcuts that should not pass through to the shell process.
 *
 * Key decisions:
 *   - Cmd+C with selection → copy to clipboard; without selection → pass through
 *     for SIGINT (Ctrl+C), maintaining standard terminal behavior.
 *   - Cmd+V → paste from clipboard directly into PTY (not xterm buffer).
 *   - Cmd+K → clear terminal scrollback and viewport.
 *   - Cmd+F → toggle search bar in the terminal panel.
 *   - Cmd+1-5 → switch between terminal sessions (up to 5).
 *   - Returns false to consume the event, true to let xterm handle it.
 *   - Never interferes during IME composition to preserve CJK input.
 *
 * @coordinates-with createTerminalInstance.ts — attached via term.attachCustomKeyEventHandler
 * @module components/Terminal/terminalKeyHandler
 */
import type { IPty } from "tauri-pty";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Terminal } from "@xterm/xterm";
import { useTerminalSessionStore } from "@/stores/terminalSessionStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { isMacPlatform } from "@/utils/shortcutMatch";

export interface KeyHandlerCallbacks {
  onSearch: () => void;
}

/**
 * Create a custom key event handler for the terminal.
 * Handles Cmd+C (copy/SIGINT), Cmd+V (paste), Cmd+K (clear), Cmd+F (search),
 * Cmd+1-5 (switch tab).
 * Returns a handler for `term.attachCustomKeyEventHandler()`.
 */
export function createTerminalKeyHandler(
  term: Terminal,
  ptyRef: React.RefObject<IPty | null>,
  callbacks: KeyHandlerCallbacks,
): (event: KeyboardEvent) => boolean {
  return (event: KeyboardEvent): boolean => {
    if (event.type !== "keydown") return true;
    // Never interfere during IME composition (CJK input, etc.)
    if (isImeKeyEvent(event)) return true;
    const isMod = event.metaKey || event.ctrlKey;
    if (!isMod) return true;

    if (event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "c") {
      // macOS: Cmd+C handles copy, so Ctrl+C should always pass through for SIGINT.
      // Windows/Linux: Ctrl+C should copy if there is a selection, otherwise pass through for SIGINT.
      if (isMacPlatform()) return true;
      if (!term.hasSelection()) return true;
    }

    switch (event.key.toLowerCase()) {
      case "c": {
        if (term.hasSelection()) {
          writeText(term.getSelection().trimEnd()).catch(() => {
            // Clipboard may be unavailable (permissions, headless tests). Ignore.
          });
          term.clearSelection();
          return false;
        }
        // No selection — pass through for SIGINT
        return true;
      }
      case "v": {
        readText().then((text) => {
          if (text && ptyRef.current) {
            ptyRef.current.write(text);
          }
        }).catch(() => {
          // Clipboard may be unavailable (permissions, headless tests). Ignore.
        });
        return false;
      }
      case "k": {
        term.clear();
        return false;
      }
      case "f": {
        callbacks.onSearch();
        return false;
      }
      case "1": case "2": case "3": case "4": case "5": {
        event.preventDefault();
        const idx = parseInt(event.key, 10) - 1;
        const { sessions, setActiveSession } = useTerminalSessionStore.getState();
        if (idx < sessions.length) {
          setActiveSession(sessions[idx].id);
        }
        return false;
      }
      default:
        return true;
    }
  };
}
