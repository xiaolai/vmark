/**
 * setupImeCompositionGate — Channel Ownership (plan WI-2.2/2.4/3.x)
 *
 * The gate-mode IME handler. VMark takes the text channel; xterm keeps keys.
 * There is exactly ONE writer, so this has NONE of the legacy dedup machinery
 * (grace window, 80/150 ms timers, echo token, Path A/B) — the entire reason
 * those existed was the dual-writer race this design removes.
 *
 * Mechanism:
 *   - T1: a CAPTURE-phase `input` listener on the CONTAINER (a strict ancestor
 *     of the textarea). xterm's own `input` listener is capture-phase on the
 *     textarea, and capture descends container → textarea, so this fires first
 *     and `stopPropagation()` prevents xterm's `_inputEvent` from ever running.
 *     Plain ASCII is unaffected — xterm writes that via its KEYDOWN path, which
 *     T1 does not touch; the redundant `input` event is simply stopped.
 *   - Composition: compositionstart snapshots the textarea length; compositionend
 *     asks the pure resolveCommit() what to commit, fires onCompositionCommit,
 *     then (T3) clears textarea.value synchronously so xterm's setTimeout(0)
 *     finalizer reads "" and emits nothing.
 *   - The plain-insertText path (WeChat Shift punctuation: no composition cycle)
 *     is the same container `input` listener — resolveCommit handles it.
 *
 * Commits are delivered via onCompositionCommit, which the wiring writes DIRECTLY
 * to the PTY (bypassing xterm's onData), so the single-writer guarantee holds end
 * to end. Exposes the same ImeCompositionHandle surface as the legacy module so
 * createTerminalInstance can select either by the `inputGate` flag.
 *
 * @coordinates-with createTerminalInstance.ts — sole caller (gate branch)
 * @coordinates-with terminalKeyHandler.ts — T2 (IME keydown returns false)
 * @module components/Terminal/setupImeCompositionGate
 */
import { terminalLog } from "@/utils/debug";
import { NON_ASCII_RE } from "./imeCharClass";
import { resolveCommit } from "./resolveCommit";
import type { ImeCompositionHandle } from "./setupImeComposition";

interface GateOptions {
  container: HTMLElement;
  textarea: HTMLTextAreaElement;
}

/**
 * Inert IME handle for when the helper textarea is unavailable (prod, after a
 * fail-loud log in resolveHelperTextarea). The terminal still works minus IME;
 * this replaces the old path that crashed on `textarea!.addEventListener`.
 * A fresh object per call — onCompositionCommit is per-session mutable state.
 */
export function createNoopImeHandle(): ImeCompositionHandle {
  return {
    get composing() { return false; },
    get inGracePeriod() { return false; },
    get onCompositionCommit() { return null; },
    set onCompositionCommit(_cb: ((text: string) => void) | null) { /* no IME */ },
    get lastCommittedText() { return null; },
    get lastCommitTime() { return 0; },
    cleanup: () => {},
    flushPending: () => {},
  };
}

export function setupImeCompositionGate({ container, textarea }: GateOptions): ImeCompositionHandle {
  let composing = false;
  let onCompositionCommit: ((text: string) => void) | null = null;
  let lastCommittedText: string | null = null;
  let lastCommitTime = 0;
  let textareaStartLen = 0;
  /** True between a real compositionstart and its compositionend. Guards against
   *  an orphan compositionend (fcitx5/rime #659/#948) trusting a stale textarea
   *  snapshot: with no start, textareaStartLen is meaningless, so we ignore the
   *  diff and accept only trustworthy non-ASCII e.data. */
  let started = false;
  /** Post-commit echo token: the text just committed, cleared on the next
   *  macrotask. A trailing insertText (or a re-fired compositionend) that
   *  restates it within the same task is the IME echoing the commit, not a fresh
   *  keystroke, so it is dropped. Same proven shape as the legacy cb954392 fix.
   *  NOTE: this catches only SAME-TASK echoes; a cross-task IME echo would need a
   *  recorded real trace to characterise (gate mode still needs human-IME
   *  verification before its default flip — see the plan). */
  let echoText: string | null = null;

  const isEcho = (text: string) => text === echoText;

  const commit = (text: string) => {
    lastCommittedText = text;
    lastCommitTime = Date.now();
    echoText = text;
    setTimeout(() => {
      echoText = null;
    }, 0);
    try {
      onCompositionCommit?.(text);
    } catch {
      // best-effort: PTY may already be closing
    }
  };

  const onCompositionStart = () => {
    composing = true;
    started = true;
    textareaStartLen = textarea.value.length;
    terminalLog("gate compositionstart");
  };

  const onCompositionEnd = (e: CompositionEvent) => {
    composing = false;
    // Only trust the textarea diff when a real compositionstart set the snapshot
    // (F2). Orphan compositionend → diff "", so resolveCommit uses only e.data.
    const wasStarted = started;
    const textareaDiff = wasStarted ? textarea.value.slice(textareaStartLen) : "";
    started = false;
    let text = resolveCommit({ eventData: e.data, textareaDiff });
    // A REAL composition result must be committed even if it is ASCII: T2
    // (keyCode-229) blocked xterm's keydown path during composition, so nothing
    // else delivers it. resolveCommit returns null for ASCII (correct for the
    // no-composition onInput path — xterm keydown owns that), so fall back to the
    // composition's own text here (audit D3.1). Orphan ends are NOT eligible.
    if (!text && wasStarted) text = e.data || textareaDiff || null;
    terminalLog("gate compositionend", e.data, "->", text);
    // T3: clear the textarea synchronously so xterm's setTimeout(0)
    // _finalizeComposition reads "" and emits nothing.
    textarea.value = "";
    if (text && !isEcho(text)) commit(text); // drop a re-fired duplicate (F2)
  };

  // T1: container capture listener. For a plain `insertText` outside composition
  // it forwards an IME-origin non-ASCII insert and stops the event so xterm's
  // `_inputEvent` never fires. NOTE: it does NOT stop every input — composition-
  // phase inserts (insertCompositionText, isComposing, or while `composing`) and
  // non-insertText inputs (deletes, paste) are left for xterm/the composition
  // cycle. Whether xterm can still originate a write from those during a real IME
  // cycle is exactly what the human matrix must confirm before Phase 4 (audit D1.4/D3.2).
  const onInput = (e: Event) => {
    const ie = e as InputEvent;
    if (ie.inputType !== "insertText" || ie.isComposing || composing) {
      return;
    }
    // Sever xterm's _inputEvent for this insert.
    e.stopPropagation();
    const data = ie.data;
    if (!data || !NON_ASCII_RE.test(data)) {
      // Plain ASCII already went to the PTY via xterm's keydown path; just drop
      // the redundant (now-stopped) input event and clear the textarea.
      textarea.value = "";
      return;
    }
    // Non-ASCII insert. Either a no-composition WeChat commit (forward it) or the
    // post-commit echo of a composition that just ended (drop it — F1).
    textarea.value = "";
    if (!isEcho(data)) commit(data);
  };

  container.addEventListener("compositionstart", onCompositionStart, true);
  container.addEventListener("compositionend", onCompositionEnd, true);
  container.addEventListener("input", onInput, true);

  const cleanup = () => {
    container.removeEventListener("compositionstart", onCompositionStart, true);
    container.removeEventListener("compositionend", onCompositionEnd, true);
    container.removeEventListener("input", onInput, true);
  };

  return {
    get composing() { return composing; },
    // Gate mode has no grace window — inGracePeriod is always false.
    get inGracePeriod() { return false; },
    get onCompositionCommit() { return onCompositionCommit; },
    set onCompositionCommit(cb: ((text: string) => void) | null) { onCompositionCommit = cb; },
    get lastCommittedText() { return lastCommittedText; },
    get lastCommitTime() { return lastCommitTime; },
    cleanup,
    // No pending grace state, so flushPending is a no-op (satisfies the handle).
    flushPending: () => {},
  };
}
