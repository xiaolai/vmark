/**
 * terminalSessionInputWiring
 *
 * Purpose: Wires xterm input (onData) and IME composition commits onto a
 * session entry, forwarding clean text to the PTY. Under Channel Ownership
 * (WI-4b) there is exactly ONE writer per keystroke — ASCII arrives via xterm's
 * onData (keydown path), IME commits via onCompositionCommit — so the legacy
 * dual-writer dedup machinery (grace window, 150ms window, Path A/B, the
 * cross-path echo token) is gone; nothing here needs to reconcile a double write.
 *
 * Key decisions:
 *   - onData is dropped while a composition is active (no writes mid-compose).
 *   - IME commits are written straight to the PTY (single writer).
 *   - Press-any-key-to-restart: after a shell exits, either an onData chunk OR
 *     an IME commit triggers respawn.
 *
 * @coordinates-with useTerminalSessions.ts — sole caller
 * @module components/Terminal/terminalSessionInputWiring
 */
import type { IPty } from "@/lib/pty";
import type { TerminalInstance } from "./createTerminalInstance";

/**
 * Per-session input state needed by the wiring. Mirrors the relevant
 * fields of the hook's private SessionEntry.
 */
export interface SessionInputState {
  instance: TerminalInstance;
  pty: IPty | null;
  shellExited: boolean;
}

interface WireOptions {
  sessionId: string;
  /** Resolves the live entry by id, or undefined if it's been removed. */
  getEntry: (id: string) => SessionInputState | undefined;
  /** Respawn the shell — fired on first key after exit. */
  startShell: (id: string) => void;
}

/**
 * Attach onCompositionCommit and onData handlers for a session. The
 * underlying xterm subscriptions are owned by the terminal instance and
 * cleaned up via term.dispose(); no separate cleanup is returned.
 */
export function wireSessionInput({ sessionId, getEntry, startShell }: WireOptions): void {
  const entry = getEntry(sessionId);
  if (!entry) return;
  const { instance } = entry;

  // IME composition commit: write clean committed text straight to the PTY (the
  // single writer for IME text; ASCII goes via onData below).
  instance.onCompositionCommit = (text: string) => {
    const e = getEntry(sessionId);
    if (!e) return;
    if (e.pty) {
      e.pty.write(text);
      return;
    }
    if (e.shellExited) {
      // "Press any key to restart" — treat an IME commit as that key. The
      // committed text is intentionally not replayed; the user retypes once a
      // fresh prompt appears.
      e.shellExited = false;
      e.instance.term.clear();
      startShell(sessionId);
    }
    // During shell spawn or before first start: text is dropped (no prompt is
    // visible yet, so buffering would be confusing).
  };

  // xterm → PTY (or restart on first key after exit).
  instance.term.onData((data) => {
    const e = getEntry(sessionId);
    if (!e) return;
    // No writes while a composition is active — the commit path delivers the text.
    if (instance.composing) return;

    if (e.shellExited && !e.pty) {
      e.shellExited = false;
      e.instance.term.clear();
      startShell(sessionId);
      return;
    }
    if (e.pty) {
      e.pty.write(data);
      // An ACCEPTED write — the gate keys insert ownership off this, so a
      // suppressed onData (the composing check above) never counts (WI-13).
      instance.noteExternalWrite(data);
    }
  });
}
