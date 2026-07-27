/**
 * setupOsc52
 *
 * Purpose: OSC 52 clipboard support (T13/WI-3.5) — lets a program running
 * inside the terminal (over `ssh`, inside `tmux`, a remote editor) put text on
 * the HOST clipboard by printing an escape sequence. Without it, "yank" in a
 * remote vim goes nowhere the user can paste from.
 *
 * Key decisions:
 *   - **Write-only.** OSC 52 also defines a *read* request, and the addon's
 *     default `BrowserClipboardProvider` answers it. That turns "anything that
 *     can print bytes to your terminal" into "anything that can read your
 *     clipboard" — `cat`-ing a hostile file is enough, and the payload comes
 *     back as if the user typed it. iTerm2 and VS Code both deny read by
 *     default; so does VMark. `readText` returns "" unconditionally and logs,
 *     so a denied attempt is visible rather than silent.
 *   - Writes go through `@tauri-apps/plugin-clipboard-manager`, the same path
 *     every other VMark clipboard write uses — NOT `navigator.clipboard`,
 *     which the addon's default provider assumes and which is subject to
 *     document-focus rules that do not hold for a terminal repaint.
 *   - A rejected write is swallowed and logged. This provider is invoked from
 *     inside xterm's parser; throwing would surface as an unhandled rejection
 *     on every OSC 52 sequence and could break the data path.
 *   - Gated by `settings.terminal.osc52Clipboard` (default on) so a user who
 *     considers even write access too much can turn the channel off entirely.
 *
 * @coordinates-with createTerminalInstance.ts — sole caller
 * @coordinates-with setupCopyOnSelect.ts — same clipboard plugin, different trigger
 * @module components/Terminal/setupOsc52
 */
import type { Terminal } from "@xterm/xterm";
import {
  ClipboardAddon,
  type IClipboardProvider,
  type ClipboardSelectionType,
} from "@xterm/addon-clipboard";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { clipboardWarn, terminalLog } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

/**
 * VMark's clipboard provider: writes reach the host clipboard, reads never do.
 * Exported so the read-denial can be asserted directly.
 */
export function createVMarkClipboardProvider(): IClipboardProvider {
  return {
    /**
     * Always denies. Returning "" (rather than throwing) is what the OSC 52
     * spec calls an empty clipboard, so a well-behaved program just moves on.
     */
    async readText(selection: ClipboardSelectionType): Promise<string> {
      terminalLog(
        `OSC 52 clipboard READ denied (selection "${selection}") — reads are an ` +
          "exfiltration channel available to anything that can print to the terminal.",
      );
      return "";
    },

    async writeText(
      selection: ClipboardSelectionType,
      text: string,
    ): Promise<void> {
      try {
        await writeText(text);
      } catch (error: unknown) {
        clipboardWarn(
          `OSC 52 clipboard write failed (selection "${selection}"):`,
          errorMessage(error),
        );
      }
    },
  };
}

/**
 * Load the OSC 52 clipboard addon onto a terminal when enabled. Returns a
 * cleanup function that is safe to call unconditionally and more than once.
 */
export function setupOsc52(term: Terminal, enabled: boolean): () => void {
  if (!enabled) return () => {};
  let addon: ClipboardAddon | null = null;
  try {
    addon = new ClipboardAddon(undefined, createVMarkClipboardProvider());
    term.loadAddon(addon);
  } catch (error: unknown) {
    // A failed addon must degrade to "no OSC 52", never to a terminal that
    // cannot be created at all.
    clipboardWarn("OSC 52 addon unavailable:", errorMessage(error));
    addon = null;
    return () => {};
  }
  return () => {
    if (!addon) return;
    const disposing = addon;
    addon = null;
    try {
      disposing.dispose();
    } catch {
      /* already disposed with the terminal */
    }
  };
}
