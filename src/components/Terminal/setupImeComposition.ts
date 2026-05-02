/**
 * setupImeComposition
 *
 * Purpose: IME composition tracking on xterm.js's hidden helper textarea.
 * Suppresses xterm's garbled `onData` re-emission during CJK input and
 * delivers clean committed text to the PTY via an explicit callback.
 *
 * Key decisions (preserved from the original inline implementation):
 *   - 80ms grace period after compositionend during which `composing`
 *     stays true so xterm's onData re-emission is blocked (#59, #454,
 *     #525, #608, #619). After the timer, the clean committed text is
 *     fired via `onCompositionCommit`, bypassing xterm's onData entirely.
 *   - Rapid back-to-back compositions flush the previous pending text
 *     immediately on compositionstart, preventing input loss when typing
 *     fast in pinyin/zhuyin.
 *   - Single non-ASCII chars (CJK punctuation/brackets) flush
 *     immediately without a grace period — they don't trigger xterm's
 *     space injection, so the dedup mechanism isn't needed (#525).
 *   - Spurious compositionend events without a preceding compositionstart
 *     (fcitx5+rime on Linux: #659) are dropped to prevent duplicate PTY
 *     writes.
 *   - Orphaned grace timers from rapid compositionend pairs are cleared
 *     before scheduling new ones.
 *   - `lastCommittedText` / `lastCommitTime` are exposed for the caller
 *     to dedup against late onData chunks that arrive after the grace
 *     period ends (#525).
 *
 * @coordinates-with createTerminalInstance.ts — sole caller
 * @module components/Terminal/setupImeComposition
 */
import { terminalLog } from "@/utils/debug";

/** Milliseconds to keep composing=true after compositionend to block xterm's onData re-emission. */
export const IME_COMPOSITION_GRACE_MS = 80;

/** Public surface returned to the factory. All getters expose live state. */
export interface ImeCompositionHandle {
  /** True while a composition is active OR within the post-end grace period. */
  readonly composing: boolean;
  /** True only during the grace period (composition has ended but onData is still blocked). */
  readonly inGracePeriod: boolean;
  /**
   * Caller-supplied callback invoked with the clean committed text after a
   * composition ends. Caller writes the text directly to the PTY, bypassing
   * xterm's onData (which may inject spaces between syllable segments).
   */
  onCompositionCommit: ((text: string) => void) | null;
  /** Last text committed via onCompositionCommit — for late-onData dedup (#525). */
  readonly lastCommittedText: string | null;
  /** Timestamp of the last onCompositionCommit fire (Date.now() value). */
  readonly lastCommitTime: number;
  /** Tear down listeners and flush any pending committed text. Idempotent. */
  cleanup: () => void;
}

interface SetupOptions {
  container: HTMLElement;
}

/**
 * Attach IME composition listeners to xterm's helper textarea inside the
 * given container. If the textarea isn't present yet (e.g. xterm not opened),
 * a debug log is emitted and the returned handle is a no-op.
 */
export function setupImeComposition({ container }: SetupOptions): ImeCompositionHandle {
  let composing = false;
  let inGracePeriod = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingCommitText: string | null = null;
  let onCompositionCommit: ((text: string) => void) | null = null;
  let lastCommittedText: string | null = null;
  let lastCommitTime = 0;

  const textarea = container.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");

  const flushPendingCommit = () => {
    if (pendingCommitText && onCompositionCommit) {
      lastCommittedText = pendingCommitText;
      lastCommitTime = Date.now();
      try {
        onCompositionCommit(pendingCommitText);
      } catch {
        // best-effort: PTY may already be closing
      }
    }
    pendingCommitText = null;
  };

  const onCompositionStart = () => {
    // Flush any pending commit from a previous compositionend before starting
    // a new composition — prevents input loss in rapid back-to-back commits.
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
      flushPendingCommit();
    }
    composing = true;
    inGracePeriod = false;
    terminalLog("compositionstart");
  };

  const onCompositionEnd = (e: CompositionEvent) => {
    const committedText = e.data;
    terminalLog("compositionend", committedText);

    // Guard: spurious compositionend without preceding compositionstart
    // (fcitx5+rime on Linux: #659).
    if (!composing && !inGracePeriod) return;

    // Single non-ASCII char (CJK punctuation/bracket) — flush immediately.
    // These don't trigger xterm's garbled space injection (#525).
    // eslint-disable-next-line no-control-regex
    if (committedText && committedText.length === 1 && !/^[\x00-\x7F]$/.test(committedText)) {
      composing = false;
      inGracePeriod = false;
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      pendingCommitText = null;
      lastCommittedText = committedText;
      lastCommitTime = Date.now();
      if (onCompositionCommit) {
        onCompositionCommit(committedText);
      }
      return;
    }

    // Multi-char or ASCII: grace period blocks ALL xterm onData; we deliver
    // the clean committed text via onCompositionCommit when it expires.
    // Cancel any orphaned timer from a previous compositionend that fired
    // without a compositionstart in between (fcitx5+rime on Linux: #659).
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    pendingCommitText = committedText;
    inGracePeriod = true;
    graceTimer = setTimeout(() => {
      graceTimer = null;
      composing = false;
      inGracePeriod = false;
      flushPendingCommit();
    }, IME_COMPOSITION_GRACE_MS);
  };

  if (textarea) {
    textarea.addEventListener("compositionstart", onCompositionStart);
    textarea.addEventListener("compositionend", onCompositionEnd);
  } else {
    terminalLog("xterm-helper-textarea not found — IME composition tracking disabled");
  }

  const cleanup = () => {
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
      flushPendingCommit();
    }
    if (textarea) {
      textarea.removeEventListener("compositionstart", onCompositionStart);
      textarea.removeEventListener("compositionend", onCompositionEnd);
    }
  };

  return {
    get composing() { return composing; },
    get inGracePeriod() { return inGracePeriod; },
    get onCompositionCommit() { return onCompositionCommit; },
    set onCompositionCommit(cb: ((text: string) => void) | null) { onCompositionCommit = cb; },
    get lastCommittedText() { return lastCommittedText; },
    get lastCommitTime() { return lastCommitTime; },
    cleanup,
  };
}
