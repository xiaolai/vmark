/**
 * imeGateMachine — the PURE state at the heart of the terminal IME gate.
 *
 * Every decision the gate makes — commit, drop, clear — is computed here from
 * five pieces of temporal state, with no DOM, no timers, no logging. The DOM
 * listener wiring lives in setupImeCompositionGate.ts and merely translates
 * events into these calls and actions into effects.
 *
 * Extracted because the previous shape — the same state as ad-hoc closure
 * variables across several listeners — produced three consecutive
 * state-machine bugs (claim retired too early, claim spent by the wrong
 * keystroke, ownership read for the previous key). A machine whose transitions
 * are named and unit-tested is the structural answer, not more care.
 *
 * State:
 *   - composing/started/startLen — the composition cycle and its textarea
 *     snapshot. `started` guards an ORPHAN compositionend (fcitx5/rime
 *     #659/#948) from trusting a stale snapshot; the orphan's own e.data is
 *     still committed, ASCII included (#1375), unless xterm wrote it.
 *   - echoText — the text just committed; an insert restating it within the
 *     same macrotask is the IME echoing the commit, not a fresh keystroke.
 *     The HOST clears it on the next macrotask (`clearEcho`) — timers are an
 *     effect.
 *   - externalWrote — did the wiring ACTUALLY forward an onData to the PTY
 *     since the last insert? Ownership derives from writes, never keydowns:
 *     IME inserts arrive before their own keydown, non-inserting
 *     keydowns write nothing, and a mid-composition keydown's onData is
 *     suppressed by the wiring. The flag EXPIRES on the next macrotask (same
 *     lifetime as echoText, host-scheduled): a keystroke's paired input event
 *     arrives before that timer fires, but a write with NO paired input — a
 *     single-character term.paste(), whose native insert xterm preventDefaults
 *     — must not linger and swallow the next gate-owned insert. A generation
 *     token keeps a stale timer from clearing a FRESH write's claim.
 *   - heldBase — the single letter xterm last wrote to the PTY, kept while only
 *     press-and-hold keys follow (a repeat of that key, the picker's digits,
 *     arrows, Enter, Escape, Shift). macOS's accent picker REPLACES the letter
 *     before the caret, but the gate already emptied the textarea, so WebKit
 *     has nothing to select and delivers the accent as a fresh insert (#1608).
 *     An accented variant of heldBase is therefore committed as DEL + accent;
 *     a picker cancelled back to the letter itself commits nothing. Any other
 *     key, write or commit clears it, falling back to a plain commit.
 *
 * @coordinates-with setupImeCompositionGate.ts — DOM wiring, sole consumer
 * @coordinates-with resolveCommit.ts — the compositionend decision helper
 * @module components/Terminal/imeGateMachine
 */

import { isAccentVariantOf } from "./accentVariant";
import { resolveCommit } from "./resolveCommit";

/** The byte xterm sends for Backspace: erases the letter the picker replaces. */
const DEL = "\x7f";

/** Keys the press-and-hold picker consumes without ending the hold. */
const PICKER_KEY_RE = /^(?:[1-9]|Arrow(?:Left|Right|Up|Down)|Enter|Escape|Shift)$/;

/** What the wiring must do in response to an event. */
export interface GateAction {
  /** Deliver this text to the PTY (via onCompositionCommit). */
  commit: string | null;
  /** Clear the helper textarea so xterm's finalizer reads "" (T3). */
  clearTextarea: boolean;
  /** stopPropagation() — sever xterm's `_inputEvent` for this insert (T1). */
  stopEvent: boolean;
  /** Schedule `clearEcho()` on the next macrotask. */
  scheduleEchoClear: boolean;
}

const NOTHING: GateAction = {
  commit: null,
  clearTextarea: false,
  stopEvent: false,
  scheduleEchoClear: false,
};

/** True for exactly one CHARACTER — `𠀀` is one, though it is two code units. */
function isSingleCharacter(text: string): boolean {
  const iter = text[Symbol.iterator]();
  return iter.next().done === false && iter.next().done === true;
}

/** A single printable character — the only onData an insert can restate. */
function isPrintableWrite(data: string): boolean {
  if (!isSingleCharacter(data)) return false;
  const code = data.codePointAt(0) ?? 0;
  return code >= 0x20 && code !== 0x7f;
}

export interface ImeGateMachine {
  readonly composing: boolean;
  compositionStart(textareaLength: number): void;
  compositionEnd(eventData: string | null, textareaValue: string): GateAction;
  input(
    ev: { data: string | null; inputType: string; isComposing: boolean },
    textareaValue: string
  ): GateAction;
  /** The wiring forwarded this onData to the PTY. Returns a
   *  generation token the host passes back to `expireExternalWrite`. */
  externalWrite(data: string): number;
  /** Next-macrotask callback: `gen`'s write can no longer own an insert.
   *  A stale token (a newer write happened since) is a no-op. */
  expireExternalWrite(gen: number): void;
  /** Next-macrotask callback: the echo window is over. */
  clearEcho(): void;
  /** A keydown reached the terminal; only press-and-hold keys keep heldBase. */
  keydown(ev: { key: string; repeat: boolean }): void;
}

export function createImeGateMachine(): ImeGateMachine {
  let composing = false;
  let started = false;
  let startLen = 0;
  let echoText: string | null = null;
  let externalWrote = false;
  let writeGeneration = 0;
  let heldBase: string | null = null;

  const isEcho = (text: string) => text === echoText;

  /** A decided commit: record the echo token and ask the host to clear it.
   *  An accented variant of the held letter first erases that letter. */
  const committed = (text: string, base: Omit<GateAction, "commit" | "scheduleEchoClear">) => {
    const replacesHeld = heldBase !== null && isAccentVariantOf(heldBase, text);
    heldBase = null;
    echoText = text;
    return { ...base, commit: replacesHeld ? DEL + text : text, scheduleEchoClear: true };
  };

  return {
    get composing() {
      return composing;
    },

    compositionStart(textareaLength) {
      composing = true;
      started = true;
      startLen = textareaLength;
    },

    compositionEnd(eventData, textareaValue) {
      composing = false;
      // Only trust the textarea diff when a real compositionstart set the
      // snapshot (F2). Orphan end → diff "", so resolveCommit uses only e.data.
      const wasStarted = started;
      const textareaDiff = wasStarted ? textareaValue.slice(startLen) : "";
      started = false;
      let text = resolveCommit({ eventData, textareaDiff });
      // A composition result must be committed even when ASCII — T2 blocked
      // xterm's keydown path, so nothing else delivers it (D3.1). Gated on
      // e.data being NON-EMPTY: empty data is a CANCELLED composition (Escape),
      // and the textarea still holds the preedit at that instant — falling back
      // to the diff typed the raw pinyin into the shell.
      //
      // An ORPHAN end qualifies too (#1375). WebKitGTK + fcitx5 never fires
      // compositionstart, so every commit arrives as an orphan end — including
      // the raw Latin text Rime's Enter confirms — and the insert before it is
      // `insertFromComposition`, which neither input() nor xterm takes. With no
      // composition behind it, an orphan end answers input()'s ownership
      // question: skip it only when xterm's keydown path already wrote this
      // keystroke. The claim is read, not spent, so a paired insert that is
      // still coming stays dropped too.
      if (!text && eventData && (wasStarted || !externalWrote)) text = eventData;
      // A press-and-hold picker cancelled back to the held letter: the PTY
      // already has it.
      if (wasStarted && text !== null && text === heldBase) {
        heldBase = null;
        return { ...NOTHING, clearTextarea: true };
      }
      // T3: always clear so xterm's setTimeout(0) finalizer reads "".
      if (text && !isEcho(text)) {
        return committed(text, { clearTextarea: true, stopEvent: false });
      }
      return { ...NOTHING, clearTextarea: true };
    },

    input(ev, textareaValue) {
      // Composition-phase inserts belong to the composition cycle.
      if (ev.inputType !== "insertText" || ev.isComposing || composing) {
        return NOTHING;
      }
      const xtermWroteIt = externalWrote;
      externalWrote = false;
      // `data` is the inserted text. An IME that reports null still put the
      // character in the textarea — but only a SINGLE character is a credible
      // substitute: the textarea can hold a whole accumulated line, and
      // handing that to the shell would execute it.
      const data = ev.data || (isSingleCharacter(textareaValue) ? textareaValue : "");
      if (!data) {
        return { ...NOTHING, clearTextarea: true, stopEvent: true };
      }
      // ASCII and non-ASCII decide identically since ownership became
      // write-derived: forward unless xterm already wrote it (AZERTY `é`
      // doubles otherwise) or it restates the commit that just happened.
      if (xtermWroteIt || isEcho(data)) {
        return { ...NOTHING, clearTextarea: true, stopEvent: true };
      }
      return committed(data, { clearTextarea: true, stopEvent: true });
    },

    externalWrite(data) {
      externalWrote = isPrintableWrite(data);
      heldBase = externalWrote ? data : null;
      return ++writeGeneration;
    },

    expireExternalWrite(gen) {
      if (gen === writeGeneration) externalWrote = false;
    },

    clearEcho() {
      echoText = null;
    },

    keydown({ key, repeat }) {
      if (heldBase === null) return;
      if (key === heldBase ? repeat : PICKER_KEY_RE.test(key)) return;
      heldBase = null;
    },
  };
}
