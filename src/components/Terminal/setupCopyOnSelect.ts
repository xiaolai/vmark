/**
 * setupCopyOnSelect
 *
 * Purpose: Copy-on-select handler for an xterm.js Terminal — writes the
 * current selection to the system clipboard, debounced and gated by the
 * user setting `terminal.copyOnSelect`. Suppressed during IME composition
 * to avoid clipboard noise from intermediate selection states.
 *
 * Key decisions:
 *   - 150ms debounce so dragging across cells doesn't fire repeated writes.
 *   - The selection is re-checked at flush time; the user may have collapsed
 *     it before the timer fires.
 *   - Trimmed trailing whitespace on copy (xterm reports padded cells).
 *
 * @coordinates-with createTerminalInstance.ts — sole caller
 * @module components/Terminal/setupCopyOnSelect
 */
import type { Terminal } from "@xterm/xterm";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useSettingsStore } from "@/stores/settingsStore";
import { clipboardWarn } from "@/utils/debug";

const COPY_ON_SELECT_DEBOUNCE_MS = 150;

interface SetupOptions {
  term: Terminal;
  /** Returns true while an IME composition (or its grace period) is active. */
  isComposing: () => boolean;
}

/** Wire copy-on-select onto a Terminal. Returns a cleanup function. */
export function setupCopyOnSelect({ term, isComposing }: SetupOptions): () => void {
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  const subscription = term.onSelectionChange(() => {
    if (copyTimer) {
      clearTimeout(copyTimer);
      copyTimer = null;
    }
    if (isComposing() || !term.hasSelection()) return;
    if (!useSettingsStore.getState().terminal.copyOnSelect) return;

    copyTimer = setTimeout(() => {
      copyTimer = null;
      if (!term.hasSelection()) return;
      const text = term.getSelection().trimEnd();
      if (!text) return;
      writeText(text).catch((error: unknown) => {
        clipboardWarn(
          "Clipboard write failed:",
          error instanceof Error ? error.message : String(error),
        );
      });
    }, COPY_ON_SELECT_DEBOUNCE_MS);
  });

  return () => {
    if (copyTimer) {
      clearTimeout(copyTimer);
      copyTimer = null;
    }
    // term.onSelectionChange returns an IDisposable in real xterm; some test
    // mocks return undefined — guard so dispose path is robust either way.
    if (subscription && typeof subscription.dispose === "function") {
      subscription.dispose();
    }
  };
}
