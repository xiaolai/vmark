/**
 * Code Fence Detection
 *
 * Purpose: Detects if a position is inside a fenced code block (``` or ~~~)
 * and provides information for modifying the language. Shared guard for
 * smartPaste, structuralCharProtection, markdownAutoPair,
 * markdownPairBackspace, and listContinuation.
 *
 * Key decisions (CommonMark-aligned):
 *   - Both backtick (```) and tilde (~~~) fences are recognized; a closer
 *     must use the SAME character as its opener with a run at least as long,
 *     and carry no info string.
 *   - Backtick-fence info strings may not contain backticks (such a line is
 *     not an opener at all); tilde-fence info strings may contain anything.
 *   - An unterminated opening fence extends to the end of the document.
 *     Positions after the opener line are "inside"; the opener line itself
 *     stays "outside" so consumers like markdownAutoPair's fence
 *     auto-completion are not suppressed by the fence being typed. Closed
 *     fences keep the historical behavior: opener and closer lines count
 *     as inside.
 *   - The language is the full first whitespace-delimited info-string token
 *     (so `c++`, `c#`, `objective-c` are captured whole).
 *
 *   - ONE grammar. This module resolves through `fenceRanges` in
 *     `plugins/shared/lineContent.ts` — it no longer carries its own traversal
 *     or delimiter patterns. Those patterns had no CONTAINER prefixes, so a
 *     fence inside a blockquote or a list item was invisible here and the
 *     cursor-context guards did not engage inside real code. Resolving through
 *     the authority closes that by construction rather than by keeping two
 *     parsers in step.
 *   - Its two remaining differences are PARAMETERS, not a second parser:
 *     `indentPolicy: "deep-indent"` (below) and the opener-line rule (above).
 *     Both are pinned in `__tests__/fenceGrammarAgreement.test.ts`.
 *
 * Known limitations:
 *   - Fence indentation is permissive (any run of spaces), deviating from
 *     CommonMark's 3-space cap: fences nested in list items carry 4+ raw
 *     spaces of CONTINUATION indent with no marker on the fence line, and a
 *     line-based detector cannot see list context. A 4-space run outside a
 *     list is an indented code block anyway — still code — so guard semantics
 *     hold either way, and over-including is the safe direction for a guard.
 *   - Each call scans the whole document; a single-pass/syntax-tree rewrite is
 *     deferred (out of scope).
 */

import type { EditorState, Text } from "@codemirror/state";
import { fenceRanges, type EnclosingFence } from "@/plugins/shared/fenceScanner";
import type { EditorView } from "@codemirror/view";

export interface CodeFenceInfo {
  /** Current language (empty string if none) */
  language: string;
  /** Line number of the opening fence (1-indexed) */
  startLine: number;
  /**
   * Line number of the closing fence (1-indexed), or the last document line
   * if the fence is unterminated. Read WITH `closed` — the two meanings are
   * different lines and consumers that assumed the first lost content.
   */
  endLine: number;
  /**
   * Whether a closing fence was found.
   *
   * `endLine` alone conflated "the closer" with "the end of the document", so
   * a consumer computing content as `startLine+1 .. endLine-1` dropped the
   * final line of every unterminated fence, and returned nothing at all for a
   * one-line one.
   */
  closed: boolean;
  /** Document position of the opening fence characters */
  fenceStartPos: number;
  /** Document position where the language token starts */
  languageStartPos: number;
  /** Document position at end of language (same as languageStartPos if no language) */
  languageEndPos: number;
}

/** First info-string token: [1] leading whitespace, [2] language token. */
const INFO_LANGUAGE_PATTERN = /^(\s*)(\S*)/;

/**
 * Build the public info record from a resolved fence range.
 *
 * The range comes from `fenceRanges` — the one fence grammar — and carries the
 * opener's info string and marker offset, so nothing is re-parsed here.
 */
function buildInfo(doc: Text, fence: EnclosingFence): CodeFenceInfo {
  const openerLine = doc.line(fence.open + 1);
  const infoMatch = fence.info.match(INFO_LANGUAGE_PATTERN);
  /* v8 ignore next 2 -- @preserve reason: pattern has no mandatory chars, always matches */
  const leadingWhitespace = infoMatch ? infoMatch[1] : "";
  const language = infoMatch ? infoMatch[2] : "";

  const fenceStartPos = openerLine.from + fence.markerOffset;
  // The run comes FROM the scanner. Re-deriving it here with
  // `search(/[^`~]/)` returned -1 when the opener had no info string — the
  // whole slice is markers — and the language position collapsed onto the
  // first backtick.
  const languageStartPos = fenceStartPos + fence.run + leadingWhitespace.length;

  return {
    language,
    startLine: fence.open + 1,
    endLine: fence.close + 1,
    closed: fence.closed,
    fenceStartPos,
    languageStartPos,
    languageEndPos: languageStartPos + language.length,
  };
}

export function getCodeFenceInfo(view: EditorView): CodeFenceInfo | null {
  return getCodeFenceInfoAt(view.state, view.state.selection.main.from);
}

/**
 * Position-aware variant: get code fence info for an explicit document
 * position. Use this for per-cursor checks (multi-cursor correctness).
 */
/**
 * Fence ranges for a document, memoised on the DOC IDENTITY.
 *
 * This runs on every CURSOR MOVE, not merely every keystroke: `doc.toString()`
 * copied the whole document and the scan walked every line, measured at 3.83 ms
 * per call on 1.35 MB against a 16.7 ms frame budget, 1-2x per update.
 *
 * The cache sits AROUND `fenceRanges`, never beside it. Re-deriving ranges
 * here — even "just for the common case" — is how this module came to carry a
 * second fence grammar that drifted from the shared one, leaving guards off
 * inside blockquoted and list-nested code. There is one grammar; this only
 * avoids asking it the same question twice.
 *
 * Keyed on the CodeMirror `Text` object, which is immutable and replaced on
 * every edit, so a stale entry is not reachable: a changed document is a
 * different key. One slot is enough — a cursor moving inside one document is
 * the entire access pattern — and holding a single reference cannot pin a
 * meaningful amount of memory the editor is not already holding.
 */
let cachedDoc: EditorState["doc"] | null = null;
let cachedRanges: ReturnType<typeof fenceRanges> | null = null;

function rangesFor(doc: EditorState["doc"]): ReturnType<typeof fenceRanges> {
  if (cachedDoc === doc && cachedRanges) return cachedRanges;
  const ranges = fenceRanges(doc.toString().split("\n"), "deep-indent");
  cachedDoc = doc;
  cachedRanges = ranges;
  return ranges;
}

/** Drop the memo. Tests only — production relies on doc identity. */
export function __resetFenceRangeCache(): void {
  cachedDoc = null;
  cachedRanges = null;
}

export function getCodeFenceInfoAt(state: EditorState, pos: number): CodeFenceInfo | null {
  const doc = state.doc;
  const cursorLine = doc.lineAt(pos).number - 1; // 0-based, as fenceRanges uses

  // ONE grammar. This module used to carry its own traversal and delimiter
  // patterns, which drifted from the shared scanner: its patterns had no
  // container prefixes, so a fence inside a blockquote or a list item was
  // invisible and the cursor-context guards did not engage inside real code.
  // Resolving through `fenceRanges` closes that by construction.
  //
  // `deep-indent` is the ONE deliberate difference, and it is a parameter now
  // rather than a second parser: a fence nested two list levels deep carries
  // four or more raw spaces of continuation indent, which CommonMark reads as
  // indented code. Over-including is the safe direction for a guard.
  const fence = rangesFor(doc).find(
    (range) => cursorLine >= range.open && cursorLine <= range.close
  );
  if (!fence) return null;

  // An UNCLOSED fence's opener line stays OUTSIDE, so `markdownAutoPair` is not
  // suppressed by the fence the user is still typing. A closed fence keeps the
  // historical behaviour: opener and closer both count as inside.
  if (!fence.closed && cursorLine === fence.open) return null;

  return buildInfo(doc, fence);
}

