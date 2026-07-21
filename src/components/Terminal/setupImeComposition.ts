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
 *   - Empty-data compositionend (macOS Pinyin for full-width punctuation like
 *     "？" sometimes fires e.data="") ends composition synchronously with no
 *     commit — the textarea carries the real char and our grace window would
 *     block xterm's late onData. Symptom: "？" appears only on the 2nd press.
 *   - Textarea-vs-event mismatch (macOS Pinyin: "?"→"？", "("→"（", etc.):
 *     compositionend's e.data is the ASCII key but the textarea has the CJK
 *     char. Detected by diffing textarea length since compositionstart; when
 *     the diff is non-ASCII and e.data empty/ASCII, commit the textarea diff.
 *   - `lastCommittedText` / `lastCommitTime` dedup against late onData (#525).
 *   - Plain-insertText commit path: WeChat commits Shift full-width punctuation
 *     (？！～：《》（）…) as a bare insertText `input` with NO composition cycle;
 *     xterm's double-input guard drops it. A capture-phase `input` listener
 *     forwards such non-ASCII inserts and clears the textarea (see onInput).
 *
 * @coordinates-with createTerminalInstance.ts — sole caller
 * @coordinates-with terminalSessionInputWiring.ts — onCompositionCommit → PTY, onData dedup
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
  /**
   * Snapshot of textarea.value.length at compositionstart. Lets us recover
   * what the IME actually added when e.data lies (macOS Pinyin punctuation:
   * e.data is the ASCII key, textarea has the converted CJK char).
   * Reassigned each compositionstart — keep as `let`.
   */
   
  let textareaStartLen = 0;

  const textarea = container.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");

  /** Non-ASCII detector — any code unit above 0x7F (covers BMP CJK, punctuation, etc.).
   *  Written with `\x00-\x7f` escape syntax instead of a literal U+0080–U+FFFF
   *  range. The literal form is correct but the leading U+0080 (a C1 control
   *  character) renders invisibly in browsers, terminals, and review tools,
   *  making the regex look like `/[-￿]/` and triggering false "this matches
   *  only `-` and `￿`" bug reports (issue #910). */
  // eslint-disable-next-line no-control-regex
  const NON_ASCII_RE = /[^\x00-\x7f]/;
  // eslint-disable-next-line no-control-regex
  const ALL_ASCII_RE = /^[\x00-\x7f]+$/;

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
    // Snapshot textarea length so onCompositionEnd can read what the IME
    // inserted when e.data lies (textarea-vs-event mismatch below).
    textareaStartLen = textarea?.value.length ?? 0;
    terminalLog("compositionstart");
  };

  const onCompositionEnd = (e: CompositionEvent) => {
    const committedText = e.data;
    terminalLog("compositionend", committedText);

    // compositionend with no preceding compositionstart: either a macOS re-fire
    // of recently-committed text (#659, drop it) or a fcitx5/rime commit where
    // compositionstart never fired (#948, authoritative). Discriminate via the
    // dedup buffer: a recent same-text re-fire is a duplicate, new text is fresh.
    if (!composing && !inGracePeriod) {
      if (!committedText) return;
      const isRecentDup =
        lastCommittedText !== null &&
        committedText === lastCommittedText &&
        Date.now() - lastCommitTime < IME_COMPOSITION_GRACE_MS;
      if (isRecentDup) return;
      pendingCommitText = null;
      lastCommittedText = committedText;
      lastCommitTime = Date.now();
      if (onCompositionCommit) {
        onCompositionCommit(committedText);
      }
      return;
    }

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

    // Textarea-vs-event mismatch (macOS Pinyin punctuation: e.data is the ASCII
    // key ",?(~!" but the textarea holds the converted CJK "，？（～！"). The
    // single-non-ASCII branch missed it (data is ASCII) and the grace path
    // would commit the wrong char while blocking xterm's real one. When e.data
    // is empty/pure-ASCII AND the textarea diff is non-ASCII, trust the diff.
    const textareaDiff = textarea ? textarea.value.slice(textareaStartLen) : "";
    const eDataLooksUntrustworthy =
      !committedText || ALL_ASCII_RE.test(committedText);
    if (eDataLooksUntrustworthy && textareaDiff && NON_ASCII_RE.test(textareaDiff)) {
      composing = false;
      inGracePeriod = false;
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      pendingCommitText = null;
      lastCommittedText = textareaDiff;
      lastCommitTime = Date.now();
      if (onCompositionCommit) {
        onCompositionCommit(textareaDiff);
      }
      return;
    }

    // Empty/null commit data with nothing extra in the textarea: end
    // composition synchronously, no commit. xterm's own setTimeout-driven
    // onData (if any) is free to pass through since composing is now false.
    if (!committedText) {
      composing = false;
      inGracePeriod = false;
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      pendingCommitText = null;
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

  const onInput = (e: Event) => {
    // WeChat commits Shift full-width punctuation (？！～：《》（）…) as a PLAIN
    // insertText `input` with NO composition cycle (verified trace); xterm's
    // double-input guard skips it (assuming it came via keydown, as ASCII does)
    // so it lands in the textarea, unforwarded. Forward it here and clear the
    // textarea in capture phase (before xterm's bubble listener) so xterm can't
    // double-process; record it for the onData dedup. Scope: not during our
    // composition/grace, not isComposing, inputType EXACTLY "insertText" (so
    // paste/drop/composition commits are excluded), non-ASCII only (ASCII goes
    // via keydown). See module header + the plain-insertText commit test.
    if (composing || inGracePeriod) return;
    const ie = e as InputEvent;
    if (ie.isComposing) return;
    if (ie.inputType !== "insertText") return;
    const data = ie.data;
    if (!data || !NON_ASCII_RE.test(data)) return;

    if (textarea) textarea.value = "";
    lastCommittedText = data;
    lastCommitTime = Date.now();
    terminalLog("plain-input commit", data);
    if (onCompositionCommit) {
      try {
        onCompositionCommit(data);
      } catch {
        // best-effort: PTY may already be closing
      }
    }
  };

  if (textarea) {
    textarea.addEventListener("compositionstart", onCompositionStart);
    textarea.addEventListener("compositionend", onCompositionEnd);
    // Capture phase: run before xterm's own input handler so clearing the
    // textarea prevents a double write for the dropped-punctuation case.
    textarea.addEventListener("input", onInput, true);
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
      textarea.removeEventListener("input", onInput, true);
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
