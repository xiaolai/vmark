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
 *   - Cmd/Ctrl+Up/Down → jump to previous/next command prompt (WI-3.3, requires
 *     shell integration; no-op when there are no command marks).
 *   - Shift+Enter → emits the CSI-u sequence "\x1b[13;2u" (codepoint 13 with
 *     modifier 2 = Shift) so CLI tools that key off TERM_PROGRAM=WezTerm
 *     (Claude Code, etc.) actually receive a distinguishable newline signal.
 *     Without this, xterm's default would send a plain "\r", indistinguishable
 *     from Enter — making the WezTerm impersonation in spawnPty.ts a lie and
 *     breaking the "newline in input" affordance these tools advertise as
 *     "natively supported in WezTerm."
 *   - Returns false to consume the event, true to let xterm handle it.
 *   - Never interferes during IME composition. Uses TWO checks:
 *       1) `isImeKeyEvent(event)` — covers active composition keystrokes
 *          (event.isComposing === true, or keyCode 229).
 *       2) `callbacks.isComposing()` — covers the post-`compositionend`
 *          grace window where browsers fire a follow-up keydown for the
 *          confirming key with `isComposing === false` but the IME is
 *          still settling. The terminal-wide handle in setupImeComposition
 *          keeps `composing=true` through that window (default 80 ms).
 *     Without (2), Shift+Enter / Cmd+C / Cmd+V immediately after a CJK
 *     commit would leak past the guard and write to the PTY.
 *
 * @coordinates-with createTerminalInstance.ts — attached via term.attachCustomKeyEventHandler
 * @coordinates-with setupImeComposition.ts — provides the `isComposing` callback (covers grace window)
 * @module components/Terminal/terminalKeyHandler
 */
import type { IPty } from "@/lib/pty";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Terminal } from "@xterm/xterm";
import { useUIStore } from "@/stores/uiStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { isMacPlatform } from "@/utils/shortcutMatch";
import { clipboardWarn } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

/** Callbacks provided to the terminal key handler for non-shell actions. */
export interface KeyHandlerCallbacks {
  onSearch: () => void;
  /**
   * Returns true while a composition is active OR within the post-end grace
   * period. Sourced from setupImeComposition's `ImeCompositionHandle.composing`
   * getter. Without this, the post-`compositionend` keystroke window would
   * leak past the IME guard and fire shortcuts during CJK commit.
   */
  isComposing: () => boolean;
  /** Jump to the previous/next command prompt (WI-3.3, shell integration). */
  onPromptNav?: (direction: "prev" | "next") => void;
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
    // Never interfere during IME composition (CJK input, etc.).
    // Two-layer guard — see module header for rationale.
    if (isImeKeyEvent(event)) return true;
    if (callbacks.isComposing()) return true;

    // Shift+Enter — emit the CSI-u sequence so the WezTerm impersonation
    // (TERM_PROGRAM=WezTerm in spawnPty.ts) is honest. Scoped to plain
    // Shift+Enter only; Alt/Ctrl/Cmd combos with Enter fall through.
    if (
      event.key === "Enter"
      && event.shiftKey
      && !event.metaKey
      && !event.ctrlKey
      && !event.altKey
    ) {
      event.preventDefault();
      ptyRef.current?.write("\x1b[13;2u");
      return false;
    }

    // On macOS, Ctrl is a shell/readline modifier (Ctrl+A line-start, Ctrl+K
    // kill-line, Ctrl+R, Ctrl+W, …) — only Cmd triggers VMark host shortcuts.
    // Let Ctrl-only combos pass straight through to the PTY so those keys keep
    // working; Cmd combos still match below. (Windows/Linux keep Ctrl as the
    // host modifier — pre-existing behavior.)
    if (isMacPlatform() && event.ctrlKey && !event.metaKey) return true;

    const isMod = event.metaKey || event.ctrlKey;
    if (!isMod) return true;

    // Prompt navigation (WI-3.3): Cmd/Ctrl + Up/Down jumps between command
    // prompts (requires shell integration; no-op otherwise). Plain arrows fall
    // through to the shell for history.
    if (
      callbacks.onPromptNav
      && !event.shiftKey
      && (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      callbacks.onPromptNav(event.key === "ArrowUp" ? "prev" : "next");
      return false;
    }

    if (event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "c") {
      // macOS: Cmd+C handles copy, so Ctrl+C should always pass through for SIGINT.
      // Windows/Linux: Ctrl+C should copy if there is a selection, otherwise pass through for SIGINT.
      if (isMacPlatform()) return true;
      if (!term.hasSelection()) return true;
    }

    switch (event.key.toLowerCase()) {
      case "c": {
        if (term.hasSelection()) {
          writeText(term.getSelection().trimEnd()).catch((error: unknown) => {
            clipboardWarn("Clipboard write failed:", errorMessage(error));
          });
          term.clearSelection();
          return false;
        }
        // No selection — pass through for SIGINT
        return true;
      }
      case "v": {
        // Prevent the browser's native paste on xterm's hidden textarea,
        // which would cause a second write to PTY (double-paste bug).
        event.preventDefault();
        readText().then((text) => {
          if (text && ptyRef.current) {
            ptyRef.current.write(text);
          }
        }).catch((error: unknown) => {
          clipboardWarn("Clipboard read failed:", errorMessage(error));
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
      case "a": {
        // Cmd+A inside the terminal — scope the select-all to the terminal
        // buffer. Without this, the event falls through to xterm's hidden
        // textarea and then to the browser's page-wide selectAll, which
        // highlights every visible element including the editor and
        // sidebar.
        event.preventDefault();
        term.selectAll();
        return false;
      }
      case "1": case "2": case "3": case "4": case "5": {
        event.preventDefault();
        const idx = parseInt(event.key, 10) - 1;
        const { sessions } = useUIStore.getState().terminal;
        const setActiveSession = useUIStore.getState().terminalSetActiveSession;
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
