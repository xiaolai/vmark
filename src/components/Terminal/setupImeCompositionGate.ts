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
 *     is the same container `input` listener. It classifies inline rather than
 *     calling resolveCommit: that helper answers "what did this COMPOSITION
 *     commit?", where e.data can lie and the textarea diff is the tiebreak.
 *     Outside a composition there is no diff to weigh — the question is only
 *     "did anyone else already write this?", which resolveCommit cannot see.
 *   - T4: a capture-phase `keydown` listener records who OWNS the next insert.
 *     "xterm's keydown path owns plain ASCII" holds only when xterm actually saw
 *     a usable keydown: T2 consumes keyCode-229 ones, and macOS Chinese IMEs set
 *     229 for keys they claim even with no composition running (`/`, numpad
 *     digits under Shuangpin, #1176). An insert with NO keydown behind it (IME
 *     palette click, dictation) is ours too — T1 has already stopped the event,
 *     so xterm's `_inputEvent` can never write it. Only a real non-IME keydown
 *     means "xterm already wrote this; drop the echo".
 *
 *     Ownership is deliberately NOT retired on keyup. An IME can defer its
 *     insert past the key release — likeliest at the start of a line, where it
 *     must first decide whether a Chinese word is beginning — and retiring
 *     there dropped exactly that first keystroke.
 *
 * Commits are delivered via onCompositionCommit, which the wiring writes DIRECTLY
 * to the PTY (bypassing xterm's onData), so the single-writer guarantee holds end
 * to end. This is the SOLE terminal IME path (WI-4b deleted the legacy module).
 *
 * @coordinates-with createTerminalInstance.ts — sole caller
 * @coordinates-with terminalKeyHandler.ts — T2 (IME keydown returns false)
 * @module components/Terminal/setupImeCompositionGate
 */
import { terminalLog } from "@/utils/debug";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { NON_ASCII_RE } from "./imeCharClass";
import { resolveCommit } from "./resolveCommit";

/**
 * Public surface of the terminal IME handle (gate is the sole implementation
 * since WI-4b; legacy was deleted).
 */
export interface ImeCompositionHandle {
  /** True while a composition is active. */
  readonly composing: boolean;
  /** Caller-supplied callback invoked with the clean committed text; the caller
   *  writes it straight to the PTY (single writer). */
  onCompositionCommit: ((text: string) => void) | null;
  /** Tear down listeners. Idempotent. */
  cleanup: () => void;
}

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
    get onCompositionCommit() { return null; },
    set onCompositionCommit(_cb: ((text: string) => void) | null) { /* no IME */ },
    cleanup: () => {},
  };
}

/** True for exactly one CHARACTER — `𠀀` is one, though it is two code units. */
function isSingleCharacter(text: string): boolean {
  const iter = text[Symbol.iterator]();
  return iter.next().done === false && iter.next().done === true;
}

export function setupImeCompositionGate({ container, textarea }: GateOptions): ImeCompositionHandle {
  let composing = false;
  let onCompositionCommit: ((text: string) => void) | null = null;
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
  /**
   * Did xterm's keydown path already WRITE the character this insert carries?
   *
   * True only for a keydown xterm actually turns into output: a real keyCode
   * (not IME-claimed), a single printable key, no Meta/Ctrl/Alt. Everything
   * else — Enter, Backspace, arrows, Escape, bare modifiers, Cmd chords, and
   * every keyCode-229 keydown — writes nothing, so an insert that follows one
   * is still ours to deliver.
   *
   * Tracking merely "was there a keydown?" loses a character after every Enter:
   * the Enter keydown set the flag and cleared IME mode, so the next
   * IME-claimed insert looked like something xterm had written when nothing had.
   *
   * Reset by each insert, so one keydown answers for one insert. An insert with
   * no such keydown behind it is IME-origin by ordering alone — a live Shuangpin
   * trace shows the IME's `input` arriving ~2ms BEFORE its own keydown, while
   * normal typing is keydown → xterm writes → input.
   */
  let xtermWroteSinceInsert = false;

  const isEcho = (text: string) => text === echoText;

  const commit = (text: string) => {
    echoText = text;
    setTimeout(() => {
      echoText = null;
    }, 0);
    try {
      onCompositionCommit?.(text);
    } catch (error) {
      // Best-effort: the PTY may already be closing. Log it — a delivery
      // failure here IS silent character loss, and swallowing it without a
      // trace is how that gets misreported as an IME bug.
      terminalLog("gate commit delivery failed", error);
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
    //
    // Gated on e.data being NON-EMPTY. An empty `data` is how a CANCELLED
    // composition reports itself (Escape), and at that instant the textarea
    // still holds the preedit — so falling back to the diff typed the raw
    // pinyin into the shell: cancel "ni" and the shell received "ni".
    if (!text && wasStarted && e.data) text = e.data;
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
    // Composition-phase inserts belong to the composition cycle; leave ownership
    // untouched so the keydown still answers for the insertText that follows.
    if (ie.inputType !== "insertText" || ie.isComposing || composing) {
      return;
    }
    const xtermWroteIt = xtermWroteSinceInsert;
    xtermWroteSinceInsert = false;
    // Sever xterm's _inputEvent for this insert.
    e.stopPropagation();
    // `data` is the inserted text for insertText. An IME that reports it as null
    // still put the character in the textarea — but only a SINGLE character is a
    // credible substitute. The textarea can hold a whole accumulated line, and
    // handing that to the shell would execute it.
    const data = ie.data || (isSingleCharacter(textarea.value) ? textarea.value : "");
    if (!data) {
      textarea.value = "";
      return;
    }
    if (!NON_ASCII_RE.test(data)) {
      textarea.value = "";
      // isEcho still guards the trailing insertText that restates an ASCII
      // composition result.
      if (!xtermWroteIt && !isEcho(data)) commit(data);
      return;
    }
    // Non-ASCII insert. Either a no-composition WeChat commit (forward it) or the
    // post-commit echo of a composition that just ended (drop it — F1).
    //
    // Ownership applies here too: a keyboard layout that types non-ASCII
    // DIRECTLY (AZERTY `é`, keyCode 50) is written by xterm's keydown path, and
    // forwarding it as well doubled the character.
    textarea.value = "";
    if (!xtermWroteIt && !isEcho(data)) commit(data);
  };

  // T4: capture-phase so it runs before xterm's own textarea keydown listener.
  // Records ownership only — it never consumes or mutates the event.
  const onKeyDown = (e: Event) => {
    const ev = e as KeyboardEvent;
    // keyCode 229 means an input method owns this keystroke, and T2 consumes
    // every one of those — xterm writes nothing. Nor does it for a key that
    // produces no character (Enter, arrows) or a host chord (Cmd+K).
    xtermWroteSinceInsert =
      !isImeKeyEvent(ev) &&
      ev.key.length === 1 &&
      !ev.metaKey &&
      !ev.ctrlKey &&
      !ev.altKey;
  };

  container.addEventListener("compositionstart", onCompositionStart, true);
  container.addEventListener("compositionend", onCompositionEnd, true);
  container.addEventListener("input", onInput, true);
  container.addEventListener("keydown", onKeyDown, true);

  const cleanup = () => {
    container.removeEventListener("compositionstart", onCompositionStart, true);
    container.removeEventListener("compositionend", onCompositionEnd, true);
    container.removeEventListener("input", onInput, true);
    container.removeEventListener("keydown", onKeyDown, true);
  };

  return {
    get composing() { return composing; },
    get onCompositionCommit() { return onCompositionCommit; },
    set onCompositionCommit(cb: ((text: string) => void) | null) { onCompositionCommit = cb; },
    cleanup,
  };
}
