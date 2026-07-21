/**
 * setupImeComposition
 *
 * Purpose: IME composition tracking on xterm.js's hidden helper textarea.
 * Suppresses xterm's garbled `onData` re-emission during CJK input and
 * delivers clean committed text to the PTY via an explicit callback.
 *
 * Key decisions (each branch is commented at its site below):
 *   - 80ms grace after compositionend keeps `composing` true so xterm's onData
 *     re-emission is blocked (#59, #454, #525, #608, #619); the clean text is
 *     then fired via `onCompositionCommit`, bypassing onData.
 *   - Rapid back-to-back compositions flush the previous pending text on the
 *     next compositionstart (no input loss in fast pinyin/zhuyin).
 *   - Single non-ASCII chars (CJK punctuation) flush immediately — no space
 *     injection, so no dedup needed (#525).
 *   - compositionend with no compositionstart: drop a recent re-fire (#659) but
 *     commit fresh text (fcitx5+rime, #948).
 *   - Empty-data compositionend ends synchronously with no commit — the real
 *     char is in the textarea and the grace window would block xterm's late
 *     onData ("？" appearing only on the 2nd press).
 *   - Textarea-vs-event mismatch (macOS Pinyin "?"→"？", "("→"（"): e.data is the
 *     ASCII key, the textarea has the CJK char — trust the textarea diff.
 *   - Plain-insertText path: WeChat commits Shift punctuation as a bare
 *     insertText with NO composition cycle; a capture `input` listener forwards
 *     it and clears the textarea (see onInput).
 *   - `flushPending()` commits any pending text now (panel-hide, WI-1.4).
 *
 * @coordinates-with createTerminalInstance.ts — sole caller
 * @coordinates-with terminalSessionInputWiring.ts — onCompositionCommit → PTY, onData dedup
 * @module components/Terminal/setupImeComposition
 */
import { terminalLog } from "@/utils/debug";
import { NON_ASCII_RE, ALL_ASCII_RE, isSingleNonAscii } from "./imeCharClass";

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
  /**
   * Flush any pending post-`compositionend` commit NOW (before the grace timer)
   * and end the grace window, WITHOUT tearing down listeners. Used on panel-hide
   * so committed text lands in the still-visible terminal, not a hidden shell
   * (WI-1.4).
   */
  flushPending: () => void;
}

interface SetupOptions {
  /**
   * The terminal's helper textarea, resolved by the caller via the PUBLIC
   * `term.textarea` getter (not the internal helper-textarea CSS class). The
   * caller fail-loud-guards it, so here it is always a live element — an
   * internal-class lookup that silently returned null used to disable the whole
   * IME layer with no signal (audit: medium finding).
   */
  textarea: HTMLTextAreaElement;
  /** Terminal container — unused by the legacy path; retained for the gate-path
   *  container-level `input` listener (plan WI-2.2). */
  container: HTMLElement;
}

/**
 * Attach IME composition listeners to the terminal's helper textarea. The
 * textarea is supplied by the caller (via the public `term.textarea` getter),
 * so this function no longer performs a DOM lookup and never silently no-ops.
 */
export function setupImeComposition({ textarea }: SetupOptions): ImeCompositionHandle {
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
    if (committedText && isSingleNonAscii(committedText)) {
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

  textarea.addEventListener("compositionstart", onCompositionStart);
  textarea.addEventListener("compositionend", onCompositionEnd);
  // Capture-phase `input` listener. It does NOT get to see the event first:
  // xterm binds its own listeners during term.open(), which precedes this setup,
  // and capture phase does not reorder two listeners registered on the same
  // node. The ordering guarantee this code once claimed is therefore false. The
  // gate path (plan WI-2.2) is what actually takes the text channel, by stopping
  // the event on the CONTAINER before it can reach this textarea.
  textarea.addEventListener("input", onInput, true);

  const cleanup = () => {
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
      flushPendingCommit();
    }
    textarea.removeEventListener("compositionstart", onCompositionStart);
    textarea.removeEventListener("compositionend", onCompositionEnd);
    textarea.removeEventListener("input", onInput, true);
  };

  const flushPending = () => {
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    composing = false;
    inGracePeriod = false;
    flushPendingCommit();
  };

  return {
    get composing() { return composing; },
    get inGracePeriod() { return inGracePeriod; },
    get onCompositionCommit() { return onCompositionCommit; },
    set onCompositionCommit(cb: ((text: string) => void) | null) { onCompositionCommit = cb; },
    get lastCommittedText() { return lastCommittedText; },
    get lastCommitTime() { return lastCommitTime; },
    cleanup,
    flushPending,
  };
}
