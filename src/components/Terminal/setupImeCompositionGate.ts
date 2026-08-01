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
 *   - Insert OWNERSHIP is WRITE-derived, never keydown-derived (WI-13). The
 *     session wiring reports every onData it ACTUALLY forwarded to the PTY
 *     via `noteExternalWrite`; an insert arriving while such a write is
 *     unclaimed is xterm's echo of that write and is dropped, anything else
 *     is the gate's to commit. Keydown shape cannot answer this: macOS
 *     Chinese IMEs stamp keyCode 229 on keys they merely CLAIM with no
 *     composition running (`/`, numpad digits under Shuangpin, #1176), IME
 *     inserts arrive ~2 ms BEFORE their own keydown, and a palette click or
 *     dictation has no keydown at all — three measured ways a keydown
 *     listener judged the WRONG keystroke, which is why the old T4 listener
 *     was deleted. The write claim expires on the next macrotask (via
 *     `expireExternalWrite`): a keystroke's paired input arrives inside that
 *     window, but a single-character term.paste() has NO paired input — its
 *     native insert is preventDefaulted — and a lingering claim would swallow
 *     the next gate-owned insert.
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
import { createImeGateMachine, type GateAction } from "./imeGateMachine";

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
  /**
   * The wiring reports every byte-run it ACTUALLY forwarded from xterm's
   * onData to the PTY (WI-13). Ownership of the next insert derives from a
   * write that happened, never from the keydown's shape — a suppressed onData
   * (mid-composition) therefore no longer masquerades as "xterm wrote it".
   */
  noteExternalWrite: (data: string) => void;
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
    noteExternalWrite: () => {},
    cleanup: () => {},
  };
}

export function setupImeCompositionGate({ container, textarea }: GateOptions): ImeCompositionHandle {
  const machine = createImeGateMachine();
  let onCompositionCommit: ((text: string) => void) | null = null;

  /** Apply a machine decision to the world: textarea, event, PTY, echo timer. */
  const apply = (action: GateAction, e?: Event) => {
    if (action.stopEvent && e) e.stopPropagation();
    if (action.clearTextarea) textarea.value = "";
    if (action.scheduleEchoClear) setTimeout(() => machine.clearEcho(), 0);
    if (action.commit) {
      try {
        onCompositionCommit?.(action.commit);
      } catch (error) {
        // Best-effort: the PTY may already be closing. Log it — a delivery
        // failure here IS silent character loss, and swallowing it without a
        // trace is how that gets misreported as an IME bug.
        terminalLog("gate commit delivery failed", error);
      }
    }
  };

  const onCompositionStart = () => {
    machine.compositionStart(textarea.value.length);
    terminalLog("gate compositionstart");
  };

  const onCompositionEnd = (e: CompositionEvent) => {
    const action = machine.compositionEnd(e.data, textarea.value);
    terminalLog("gate compositionend", e.data, "->", action.commit);
    apply(action, e);
  };

  // T1: container capture listener — capture descends container → textarea, so
  // this fires before xterm's own `input` listener and stopEvent severs
  // xterm's `_inputEvent` for the inserts the gate owns.
  const onInput = (e: Event) => {
    const ie = e as InputEvent;
    apply(
      machine.input(
        { data: ie.data, inputType: ie.inputType, isComposing: ie.isComposing },
        textarea.value
      ),
      e
    );
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
    get composing() { return machine.composing; },
    get onCompositionCommit() { return onCompositionCommit; },
    set onCompositionCommit(cb: ((text: string) => void) | null) { onCompositionCommit = cb; },
    noteExternalWrite: (data: string) => {
      // The claim lives one macrotask, like the echo token: a keystroke's
      // paired input event beats the timer, a paste's never-arriving input
      // must not leave the claim armed to swallow the NEXT insert.
      const gen = machine.externalWrite(data);
      setTimeout(() => machine.expireExternalWrite(gen), 0);
    },
    cleanup,
  };
}
