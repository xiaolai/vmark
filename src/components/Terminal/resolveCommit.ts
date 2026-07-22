/**
 * resolveCommit
 *
 * Purpose: the PURE decision at the heart of the gate-path IME handler — given
 * what a `compositionend` (or a plain non-composition `input`) carried, decide
 * the single string to commit to the PTY, or null for "nothing".
 *
 * This replaced the five sequential, side-effecting early-returns the now-deleted
 * legacy IME path used (each committing on partial evidence at a different point,
 * which is WHY every new IME needed a new branch). Here the decision is total,
 * synchronous, and has no DOM/timer side effects — so it is exhaustively
 * unit-testable and the gate handler just applies its result.
 *
 * Gate mode has ONE writer (T1 severs xterm's input path), so there is no dedup
 * and no timing — only "what did the user commit?".
 *
 * @module components/Terminal/resolveCommit
 */
import { ALL_ASCII_RE, NON_ASCII_RE } from "./imeCharClass";

export interface CommitInput {
  /** `compositionend`'s e.data, or the plain `input` event's data. May lie. */
  eventData: string | null;
  /** textarea.value.slice(startLen) — what the IME actually inserted. Authoritative
   *  when eventData lies (macOS Pinyin punctuation: e.data="?", textarea="？"). */
  textareaDiff: string;
}

/**
 * Decide the committed text. Precedence:
 *   1. eventData is a trustworthy non-ASCII/normal commit → use it.
 *   2. eventData is empty/pure-ASCII BUT the textarea diff is non-ASCII
 *      (punctuation-conversion lie) → trust the diff.
 *   3. eventData empty and no meaningful diff → null (nothing to commit).
 * ASCII eventData with no non-ASCII diff → null: plain ASCII reaches the PTY via
 * xterm's keydown path, not here.
 */
export function resolveCommit({ eventData, textareaDiff }: CommitInput): string | null {
  const dataUntrustworthy = !eventData || ALL_ASCII_RE.test(eventData);

  if (!dataUntrustworthy) {
    // eventData is present and contains non-ASCII — the real committed text.
    return eventData;
  }

  // eventData is empty or pure-ASCII. If the textarea shows a non-ASCII insert,
  // that is the truth (e.data lied about a converted punctuation mark).
  if (textareaDiff && NON_ASCII_RE.test(textareaDiff)) {
    return textareaDiff;
  }

  // Nothing non-ASCII to commit here — plain ASCII is xterm's keydown path.
  return null;
}
