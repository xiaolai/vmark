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
 * Known limitations:
 *   - `plugins/shared/lineContent.ts` (`fenceRanges`) is the AUTHORITY on the
 *     fence grammar; this module keeps its own traversal because its consumers
 *     need positional info (language token bounds) and different opener-line
 *     inclusion semantics. Delimiter-grammar disagreements are bugs HERE.
 *     Full consolidation is tracked in the source-structure design doc.
 *   - Fence indentation is permissive (any leading whitespace), deviating
 *     from CommonMark's 3-space cap: fences nested in list items carry 4+
 *     raw spaces of indent, and a line-based detector cannot see list
 *     context. A 4-space-indented run outside a list is an indented code
 *     block anyway — still code — so guard semantics hold either way.
 *   - Each call scans lines from the document start to the position; a
 *     single-pass/syntax-tree rewrite is deferred (out of scope).
 */

import type { EditorState } from "@codemirror/state";
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

/**
 * Opening backtick fence: 3+ backticks after optional indent; the info
 * string may not contain backticks (CommonMark), hence the end anchor.
 */
const BACKTICK_OPEN_PATTERN = /^(\s*)(`{3,})([^`]*)$/;

/** Opening tilde fence: 3+ tildes after optional indent; any info string. */
const TILDE_OPEN_PATTERN = /^(\s*)(~{3,})(.*)$/;

/** First info-string token: [1] leading whitespace, [2] language token. */
const INFO_LANGUAGE_PATTERN = /^(\s*)(\S*)/;

interface FenceOpener {
  char: "`" | "~";
  indent: string;
  runLength: number;
  info: string;
}

/** Parse a line as an opening fence, or null if it is not one. */
function parseFenceOpener(text: string): FenceOpener | null {
  const backtick = text.match(BACKTICK_OPEN_PATTERN);
  if (backtick) {
    return { char: "`", indent: backtick[1], runLength: backtick[2].length, info: backtick[3] };
  }
  const tilde = text.match(TILDE_OPEN_PATTERN);
  if (tilde) {
    return { char: "~", indent: tilde[1], runLength: tilde[2].length, info: tilde[3] };
  }
  return null;
}

/**
 * Whether a line closes the given fence: a run of the opener's character at
 * least as long as the opener's run, with nothing else but whitespace.
 */
function isFenceCloser(text: string, opener: FenceOpener): boolean {
  // Spaces and tabs only — `.trim()` also removed NBSP and other Unicode
  // spaces, accepting closers CommonMark rejects. The shared scanner in
  // plugins/shared/lineContent.ts already enforces this; the two must agree.
  const trimmed = text.replace(/^[ \t]+|[ \t]+$/g, "");
  if (trimmed.length < opener.runLength) return false;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== opener.char) return false;
  }
  return true;
}

/** Build the public info record for a resolved fence. */
function buildInfo(
  opener: FenceOpener,
  startLine: number,
  openerLineFrom: number,
  endLine: number,
  closed: boolean
): CodeFenceInfo {
  const infoMatch = opener.info.match(INFO_LANGUAGE_PATTERN);
  /* v8 ignore next 2 -- @preserve reason: pattern has no mandatory chars, always matches */
  const leadingWhitespace = infoMatch ? infoMatch[1] : "";
  const language = infoMatch ? infoMatch[2] : "";

  const fenceStartPos = openerLineFrom + opener.indent.length;
  const languageStartPos = fenceStartPos + opener.runLength + leadingWhitespace.length;

  return {
    language,
    startLine,
    endLine,
    closed,
    fenceStartPos,
    languageStartPos,
    languageEndPos: languageStartPos + language.length,
  };
}

/**
 * Get code fence info if the main-selection cursor is inside a code fence.
 * Returns null if cursor is not in a code fence.
 */
export function getCodeFenceInfo(view: EditorView): CodeFenceInfo | null {
  return getCodeFenceInfoAt(view.state, view.state.selection.main.from);
}

/**
 * Position-aware variant: get code fence info for an explicit document
 * position. Use this for per-cursor checks (multi-cursor correctness).
 */
export function getCodeFenceInfoAt(state: EditorState, pos: number): CodeFenceInfo | null {
  const doc = state.doc;
  const cursorLineNum = doc.lineAt(pos).number;

  // Top-down scan to the cursor line, tracking the open fence (if any).
  // CommonMark: while a fence is open, lines are content until a matching
  // closer — other fence-looking lines do not open nested fences.
  let opener: FenceOpener | null = null;
  let openerLineNum = 0;
  let openerLineFrom = 0;

  for (let lineNum = 1; lineNum <= cursorLineNum; lineNum++) {
    const line = doc.line(lineNum);
    if (opener) {
      if (isFenceCloser(line.text, opener)) {
        if (lineNum === cursorLineNum) {
          // Cursor sits on the closing fence line — counts as inside.
          return buildInfo(opener, openerLineNum, openerLineFrom, lineNum, true);
        }
        opener = null;
      }
    } else {
      const candidate = parseFenceOpener(line.text);
      if (candidate) {
        opener = candidate;
        openerLineNum = lineNum;
        openerLineFrom = line.from;
      }
    }
  }

  if (!opener) {
    return null; // No fence open at the cursor line
  }

  // A fence is open at the cursor line: find its closer below the cursor.
  // (Lines between the opener and the cursor were already ruled out above.)
  for (let lineNum = cursorLineNum + 1; lineNum <= doc.lines; lineNum++) {
    if (isFenceCloser(doc.line(lineNum).text, opener)) {
      return buildInfo(opener, openerLineNum, openerLineFrom, lineNum, true);
    }
  }

  // Unterminated fence: extends to the end of the document. The opener line
  // itself stays "outside" (see header) so typing the opener — e.g. the
  // third backtick of ``` — is not treated as being inside its own fence.
  if (cursorLineNum === openerLineNum) {
    return null;
  }
  return buildInfo(opener, openerLineNum, openerLineFrom, doc.lines, false);
}
