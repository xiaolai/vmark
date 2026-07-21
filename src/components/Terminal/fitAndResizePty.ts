/**
 * fitAndResizePty
 *
 * Purpose: The single place that fits an xterm to its container AND tells the
 * PTY the dimensions that fit produced. These are one logical operation: an
 * xterm whose cols/rows changed without a matching TIOCSWINSZ leaves the shell
 * drawing to the wrong width, which shows up as broken line wrapping, misplaced
 * prompt redraws, and corrupt TUI layout.
 *
 * Key decisions:
 *   - The PTY resize is debounced (the visual fit is instant; the syscall is
 *     not worth doing on every frame of a drag).
 *   - The debounce timer lives on the session entry, NOT in a shared ref. A
 *     shared timer lets one session's fit cancel another session's pending
 *     resize, permanently stranding that shell at stale dimensions.
 *   - `fit()` throwing (hidden container) cancels the resize rather than
 *     reporting whatever dimensions the failed fit left behind.
 *
 * @coordinates-with useTerminalSessions.ts — panel fit callback
 * @coordinates-with terminalSessionStoreSync.ts — font-size/line-height and
 *   mono-font changes, which both alter cell metrics
 * @coordinates-with terminalSessionRegistry.ts — visibility switch refit
 * @module components/Terminal/fitAndResizePty
 */
import type { IPty } from "@/lib/pty";

export const PTY_RESIZE_DEBOUNCE_MS = 100;

/**
 * Minimum shape this helper needs. Structural rather than importing
 * SessionEntry so the store-sync module can keep its narrower entry type.
 */
export interface FitResizeTarget {
  instance: {
    term: { cols: number; rows: number };
    fitAddon: { fit: () => void };
  };
  pty: IPty | null;
  disposed?: boolean;
  /** Per-entry debounce handle — see "Key decisions" above. */
  ptyResizeTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Fit the terminal to its container and propagate the resulting dimensions to
 * the PTY.
 *
 * @param entry   The session to fit.
 * @param isStale Optional guard evaluated at debounce time. Callers that hold a
 *                session map should use it to check the entry is still the one
 *                registered under its id, so a session swapped out mid-debounce
 *                doesn't resize its replacement's PTY.
 */
export function fitAndResizePty(
  entry: FitResizeTarget,
  isStale?: () => boolean,
): void {
  // Cancel any resize this entry had pending BEFORE fitting. If fit() throws
  // (hidden container), we return with no resize scheduled — otherwise a resize
  // queued by an earlier successful fit would still fire and push now-stale
  // dimensions to the PTY, contradicting this function's cancellation contract
  // (audit Low-15). A successful fit re-schedules below.
  clearTimeout(entry.ptyResizeTimer);
  entry.ptyResizeTimer = undefined;

  try {
    entry.instance.fitAddon.fit();
  } catch {
    // Container is not visible (display:none, zero-size). fit() made no
    // meaningful change, so there is nothing to tell the PTY.
    return;
  }

  entry.ptyResizeTimer = setTimeout(() => {
    entry.ptyResizeTimer = undefined;
    if (entry.disposed || isStale?.()) return;

    const { term } = entry.instance;
    // Zero dims mean the fit ran against a hidden container; sending 0×0 would
    // tell the shell it has no viewport at all.
    if (!entry.pty || term.cols <= 0 || term.rows <= 0) return;

    try {
      entry.pty.resize(term.cols, term.rows);
    } catch {
      // PTY exited or was disposed between the fit and this tick.
    }
  }, PTY_RESIZE_DEBOUNCE_MS);
}
