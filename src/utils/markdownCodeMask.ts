/**
 * Markdown Code Mask
 *
 * Purpose: Build a bitmask identifying code positions in markdown text,
 * allowing callers to skip code regions during formatting or link detection.
 *
 * Returns a Uint8Array the same length as the input string.
 * Positions inside fenced code blocks or inline code spans are marked `1`;
 * everything else (including fence delimiters themselves) is `0`.
 *
 * Algorithm extracted from the battle-tested `preprocessEscapedMarkers()`
 * in `parser.ts` — O(n) single-pass construction, O(1) per-match lookup.
 * Inline-code state resets at blank lines (paragraph boundaries) —
 * CommonMark never lets an inline code span cross a blank line, so an
 * unclosed backtick cannot mask the rest of the document.
 *
 * @coordinates-with markdownLinkPatterns.ts — consumers use mask to skip code before link detection
 * @coordinates-with cjkFormatter/formatter.ts — mask prevents CJK rules from mangling code
 * @module utils/markdownCodeMask
 */
/**
 * True if a backtick run of exactly `runLen` exists in `markdown` at or after
 * `from`. A CommonMark code span is closed only by a run of equal length; runs
 * of a different length are content and are skipped. An opener with no such
 * closing run is literal text, NOT a code span.
 */
function hasClosingBacktickRun(markdown: string, from: number, runLen: number): boolean {
  const len = markdown.length;
  let i = from;
  while (i < len) {
    if (markdown[i] === "`") {
      let r = 1;
      while (i + r < len && markdown[i + r] === "`") r += 1;
      if (r === runLen) return true;
      i += r;
    } else {
      i += 1;
    }
  }
  return false;
}

export function buildCodeMask(markdown: string): Uint8Array {
  const len = markdown.length;
  const mask = new Uint8Array(len); // all zeros

  let inFencedCodeBlock = false;
  let fencedChar: "`" | "~" | "" = "";
  let fencedLen = 0;

  let inInlineCode = false;
  let inlineFenceLen = 0;

  const getLineEnd = (from: number): number => {
    const idx = markdown.indexOf("\n", from);
    return idx === -1 ? len : idx;
  };

  /** Advance index past newline, or stay at EOF. */
  const pastLine = (lineEnd: number): number =>
    lineEnd < len ? lineEnd + 1 : lineEnd;

  for (let i = 0; i < len; ) {
    const atLineStart = i === 0 || markdown[i - 1] === "\n";

    // Paragraph boundary: CommonMark inline code spans never cross a
    // blank line, so an unclosed backtick must not keep masking the next
    // paragraph (or suppress fence detection there).
    if (atLineStart && inInlineCode) {
      const lineEnd = getLineEnd(i);
      if (markdown.slice(i, lineEnd).trim() === "") {
        inInlineCode = false;
        inlineFenceLen = 0;
      }
    }

    // Fenced code blocks: line-based detection
    if (atLineStart && !inInlineCode) {
      const lineEnd = getLineEnd(i);
      const line = markdown.slice(i, lineEnd);

      if (!inFencedCodeBlock) {
        const openMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (openMatch) {
          inFencedCodeBlock = true;
          fencedChar = openMatch[1][0] as "`" | "~";
          fencedLen = openMatch[1].length;
          // Fence line itself: leave as 0
          i = pastLine(lineEnd);
          continue;
        }
      } else {
        // Check for closing fence: same char, >= same count
        const closeRe = new RegExp(
          `^ {0,3}\\${fencedChar}{${fencedLen},}(?:\\s|$)`
        );
        if (closeRe.test(line)) {
          inFencedCodeBlock = false;
          fencedChar = "";
          fencedLen = 0;
          // Closing fence line: leave as 0
          i = pastLine(lineEnd);
          continue;
        }
      }

      // Inside fenced block: mark entire line as code content
      if (inFencedCodeBlock) {
        for (let j = i; j < lineEnd; j++) {
          mask[j] = 1;
        }
        // newline char itself stays 0
        i = pastLine(lineEnd);
        continue;
      }
    }

    // Invariant: while inFencedCodeBlock is true, the block above always
    // `continue`s after advancing whole lines (open fence, close fence, or
    // content line), and fence state is only ever entered at a line start
    // with inInlineCode false — so fenced state can never reach the
    // character-level scanning below.

    // Inline code spans: backtick runs
    if (markdown[i] === "`") {
      // A backslash-escaped backtick (\`) is a literal character, not a
      // span opener (CommonMark 2.4). Parity matters: `\\` is an escaped
      // backslash, so a backtick after it IS live. Escapes only apply
      // OUTSIDE code — inside a span backslashes are literal and any
      // matching-length run still closes, so the check is opener-only.
      if (!inInlineCode) {
        let backslashes = 0;
        for (let k = i - 1; k >= 0 && markdown[k] === "\\"; k--) {
          backslashes += 1;
        }
        if (backslashes % 2 === 1) {
          // Escaped: skip the literal backtick; any following backticks
          // are evaluated on their own as a potential opener run.
          i += 1;
          continue;
        }
      }

      let runLen = 1;
      while (i + runLen < len && markdown[i + runLen] === "`") {
        runLen += 1;
      }

      if (!inInlineCode) {
        // An opener only starts a code span if a matching-length closing run
        // exists later; otherwise the backticks are literal text (CommonMark).
        // Without this check an unpaired backtick would mask the entire rest of
        // the document as code.
        if (!hasClosingBacktickRun(markdown, i + runLen, runLen)) {
          // Literal backticks: leave as 0 and continue normal processing so any
          // fenced block / code span in the tail is still detected.
          i += runLen;
          continue;
        }
        inInlineCode = true;
        inlineFenceLen = runLen;
        // Opening backticks: leave as 0
        i += runLen;
        continue;
      } else if (runLen === inlineFenceLen) {
        inInlineCode = false;
        inlineFenceLen = 0;
        // Closing backticks: leave as 0
        i += runLen;
        continue;
      }
      // Mismatched backtick run inside inline code: mark as content
      for (let j = i; j < i + runLen; j++) {
        mask[j] = 1;
      }
      i += runLen;
      continue;
    }

    if (inInlineCode) {
      mask[i] = 1;
      i += 1;
      continue;
    }

    // Regular text: leave as 0
    i += 1;
  }

  return mask;
}
