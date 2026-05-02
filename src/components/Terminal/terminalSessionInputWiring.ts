/**
 * terminalSessionInputWiring
 *
 * Purpose: Wires xterm input (onData) and IME composition commits onto a
 * session entry, forwarding clean text to the PTY while suppressing the
 * garbled re-emissions that some IMEs produce. Extracted from
 * useTerminalSessions to keep that hook small.
 *
 * Key decisions (preserved from the original inline implementation):
 *   - ALL onData is dropped during composition + grace period (#59, #454,
 *     #525, #608, #619). The clean committed text is delivered via
 *     onCompositionCommit, bypassing xterm.
 *   - 150ms post-commit dedup window with a consumed-prefix pointer so
 *     chunked re-emissions ("你好" + "世界") match against the remainder
 *     of the committed text, not the full string.
 *   - Press-any-key-to-restart is implemented here: after a shell exits,
 *     either an onData chunk OR an IME commit triggers respawn.
 *
 * @coordinates-with useTerminalSessions.ts — sole caller
 * @module components/Terminal/terminalSessionInputWiring
 */
import type { IPty } from "@/lib/pty";
import { IME_DEDUP_WINDOW_MS, type TerminalInstance } from "./createTerminalInstance";

/**
 * Per-session input state needed by the wiring. Mirrors the relevant
 * fields of the hook's private SessionEntry.
 */
export interface SessionInputState {
  instance: TerminalInstance;
  pty: IPty | null;
  shellExited: boolean;
  /** Last seen instance.lastCommitTime — drives the consumed-prefix reset. */
  lastSeenCommitTime: number;
  /** Number of chars from instance.lastCommittedText already deduped. */
  lastCommittedConsumed: number;
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

  // IME composition commit: write clean committed text directly to PTY,
  // bypassing xterm's onData (which may inject spaces between segments).
  instance.onCompositionCommit = (text: string) => {
    const e = getEntry(sessionId);
    if (!e) return;
    if (e.pty) {
      e.pty.write(text);
      return;
    }
    if (e.shellExited) {
      // "Press any key to restart" — treat IME commit as that key.
      // The committed text is intentionally not replayed after restart;
      // the user retypes once a fresh prompt appears.
      e.shellExited = false;
      e.instance.term.clear();
      startShell(sessionId);
    }
    // During shell spawn or before first start: text is dropped (no prompt
    // is visible yet, so buffering would be confusing).
  };

  // xterm → PTY (or restart on first key after exit).
  instance.term.onData((data) => {
    const e = getEntry(sessionId);
    if (!e) return;
    // Block ALL onData during composition + grace period.
    if (instance.composing) return;

    // Post-grace dedup safety net (#525).
    if (
      instance.lastCommittedText &&
      Date.now() - instance.lastCommitTime < IME_DEDUP_WINDOW_MS
    ) {
      if (e.lastSeenCommitTime !== instance.lastCommitTime) {
        e.lastSeenCommitTime = instance.lastCommitTime;
        e.lastCommittedConsumed = 0;
      }
      const remainder = instance.lastCommittedText.slice(e.lastCommittedConsumed);
      if (data.length > 0 && (remainder === data || remainder.startsWith(data))) {
        e.lastCommittedConsumed += data.length;
        return;
      }
    }

    if (e.shellExited && !e.pty) {
      e.shellExited = false;
      e.instance.term.clear();
      startShell(sessionId);
      return;
    }
    if (e.pty) {
      e.pty.write(data);
    }
  });
}
