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
 *   - Cross-path echo dedup: a full-width punctuation char can arrive as BOTH
 *     an xterm onData AND our plain-input forward in one keydown, onData first.
 *     onData records the char; the forward consumes and skips the duplicate.
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
/** Non-ASCII detector for the onData↔commit echo dedup (see below). */
// eslint-disable-next-line no-control-regex
const NON_ASCII_ECHO_RE = /[^\x00-\x7f]/;

export function wireSessionInput({ sessionId, getEntry, startShell }: WireOptions): void {
  const entry = getEntry(sessionId);
  if (!entry) return;
  const { instance } = entry;

  // Cross-path echo dedup: a full-width punctuation char (e.g. macOS Pinyin
  // "！") can arrive as BOTH an xterm onData AND our plain-input forward within
  // the same keydown, with onData firing FIRST (verified via live trace). The
  // post-commit dedup below only catches the reverse order (onData after the
  // commit sets lastCommittedText), so onData writes the char and then the
  // forward writes it again → doubled. Record the char xterm's onData just
  // wrote; the forward consumes and skips the duplicate. Consuming on match
  // (not a bare time check) prevents a later same-char forward from being
  // wrongly suppressed.
  let xtermEchoText: string | null = null;
  let xtermEchoTime = 0;

  // IME composition commit: write clean committed text directly to PTY,
  // bypassing xterm's onData (which may inject spaces between segments).
  instance.onCompositionCommit = (text: string) => {
    const e = getEntry(sessionId);
    if (!e) return;
    if (e.pty) {
      // xterm's onData already delivered this exact char this keydown — skip.
      if (
        text === xtermEchoText &&
        Date.now() - xtermEchoTime < IME_DEDUP_WINDOW_MS
      ) {
        xtermEchoText = null; // consume
        return;
      }
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

    // Post-grace dedup safety net (#525, #948).
    if (
      instance.lastCommittedText &&
      Date.now() - instance.lastCommitTime < IME_DEDUP_WINDOW_MS
    ) {
      if (e.lastSeenCommitTime !== instance.lastCommitTime) {
        e.lastSeenCommitTime = instance.lastCommitTime;
        e.lastCommittedConsumed = 0;
      }
      const committed = instance.lastCommittedText;
      // Path A (#525): chunked re-emission across segments of the
      // committed string — match the unconsumed remainder.
      const remainder = committed.slice(e.lastCommittedConsumed);
      if (data.length > 0 && (remainder === data || remainder.startsWith(data))) {
        e.lastCommittedConsumed += data.length;
        return;
      }
      // Path B (#948): Linux + WebKitGTK re-emits the committed text
      // 1–2× per commit, sometimes concatenated into one chunk
      // ("你好你好"). Suppress whole-integer multiples of the
      // committed string.
      if (
        data.length > 0 &&
        committed.length > 0 &&
        data.length % committed.length === 0 &&
        data === committed.repeat(data.length / committed.length)
      ) {
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
      // Record a single non-ASCII char so a following plain-input forward for
      // the SAME char (same keydown) is deduped in onCompositionCommit above.
      if (NON_ASCII_ECHO_RE.test(data)) {
        xtermEchoText = data;
        xtermEchoTime = Date.now();
      }
      e.pty.write(data);
    }
  });
}
