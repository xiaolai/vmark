/**
 * terminalReadlineKeys
 *
 * Purpose: translate the macOS cursor/line-editing chords that xterm has no
 * meta-key → PTY mapping for into the readline control bytes bash/zsh honour.
 * Extracted from terminalKeyHandler to keep that file focused (and under the
 * 300-line limit). Behavior is identical to the inline blocks it replaced.
 *
 * Handled (macOS only; other platforms fall through untouched):
 *   - Option + Left/Right → Alt-b / Alt-f (backward/forward word). xterm's
 *     macOptionIsMeta emits "\x1b[1;3D/C" that zsh/bash don't bind (prints ";3D").
 *   - Cmd + Left/Right → ^A / ^E (line start/end).
 *   - Cmd + Backspace → ^U (kill-whole-line / unix-line-discard). Without this
 *     xterm ignores the Cmd modifier and sends a bare DEL (one character).
 * Option+Backspace is deliberately NOT handled — zsh binds \e^? to
 * backward-kill-word already.
 *
 * @coordinates-with terminalKeyHandler.ts — sole caller
 * @module components/Terminal/terminalReadlineKeys
 */
import type { IPty } from "@/lib/pty";
import { isMacPlatform } from "@/utils/shortcutMatch";

/**
 * If `event` is one of the macOS readline-nav chords, write its control byte to
 * the PTY, preventDefault, and return true (consumed). Otherwise return false so
 * the caller keeps dispatching. Modifier conditions are mutually exclusive, so
 * this is safe to call before the caller's generic Cmd/Ctrl gate.
 */
export function handleReadlineNavKey(
  event: KeyboardEvent,
  ptyRef: React.RefObject<IPty | null>,
): boolean {
  if (!isMacPlatform()) return false;

  const isLeft = event.key === "ArrowLeft";
  const isRight = event.key === "ArrowRight";

  // Option + Left/Right → word nav (Alt-b / Alt-f). Bare Option only, so
  // Option+letter dead keys fall through.
  if (
    event.altKey
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && (isLeft || isRight)
  ) {
    event.preventDefault();
    ptyRef.current?.write(isLeft ? "\x1bb" : "\x1bf");
    return true;
  }

  // Cmd + Left/Right → line start/end (^A / ^E). Shift (select) and Option
  // (word nav, above) are left to the shell.
  if (event.metaKey && !event.shiftKey && (isLeft || isRight)) {
    event.preventDefault();
    ptyRef.current?.write(isLeft ? "\x01" : "\x05");
    return true;
  }

  // Cmd + Backspace → delete the line (^U). Option+Backspace is left alone.
  if (event.metaKey && !event.altKey && !event.shiftKey && event.key === "Backspace") {
    event.preventDefault();
    ptyRef.current?.write("\x15");
    return true;
  }

  return false;
}
