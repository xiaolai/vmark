/**
 * IME Scroll Guard (CodeMirror)
 *
 * Purpose: Suppress CodeMirror's automatic `scrollIntoView` on every
 * composition update so the viewport does not jitter while a CJK IME
 * (pinyin, kana, hangul) is composing.
 *
 * Why: CodeMirror dispatches a transaction for every DOM mutation the
 * browser makes during IME composition. Each such transaction carries
 * `userEvent: "input.type.compose*"` and `scrollIntoView: true`, which
 * recomputes `view.viewState.scrollTarget` every keystroke — visible
 * to the user as the current line jumping up and down while typing
 * Chinese, Japanese, or Korean (see GitHub issue #814).
 *
 * Fix: a `transactionFilter` that strips the `scrollIntoView` flag from
 * compose transactions only. Non-compose input still auto-scrolls, and
 * the final committed text stays on screen because the cursor never
 * left the viewport during composition.
 *
 * @coordinates-with plugins/codemirror/imeGuard.ts — flushes queued work on compositionend
 * @coordinates-with utils/imeGuard.ts — shared IME state tracking
 * @module plugins/codemirror/imeScrollGuard
 */

import {
  EditorState,
  type Annotation,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";

/**
 * Transaction exposes `annotations` at runtime (@codemirror/state 6.x),
 * but its public type only declares `annotation(type)`. We cast through
 * this shape to forward every annotation to a rebuilt `TransactionSpec`.
 * If the property ever goes away in a future CM release, we fall back
 * to returning the original transaction unchanged — the viewport jitter
 * would return, but no functionality is lost.
 */
type TransactionInternals = Transaction & {
  readonly annotations?: readonly Annotation<unknown>[];
};

/**
 * Transaction filter that drops `scrollIntoView` from IME composition
 * transactions. Leaves every other transaction untouched.
 *
 * CodeMirror generates compose transactions internally with
 * `{ userEvent: "input.type.compose[.start]", scrollIntoView: true }`
 * (see `@codemirror/view` applyDOMChange). Only the boolean flag is
 * used for these — never `EditorView.scrollIntoView` effects — so
 * stripping the flag is sufficient.
 */
export const imeScrollGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.scrollIntoView) return tr;
  if (!tr.isUserEvent("input.type.compose")) return tr;

  const annotations = (tr as TransactionInternals).annotations;
  // Guard against a future CM version removing the internal `annotations`
  // array. Without annotations we cannot safely rebuild the transaction
  // (userEvent and other metadata would be lost), so leave it untouched.
  if (!annotations) return tr;

  const spec: TransactionSpec = {
    changes: tr.changes,
    selection: tr.selection,
    effects: tr.effects,
    annotations,
    filter: false,
  };
  return spec;
});
