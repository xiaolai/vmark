/**
 * Build a bitmask identifying code positions in markdown text.
 *
 * Returns a Uint8Array the same length as the input string.
 * Positions inside fenced code blocks or inline code spans are marked `1`;
 * everything else (including fence delimiters themselves) is `0`.
 *
 * Algorithm extracted from the battle-tested `preprocessEscapedMarkers()`
 * in `parser.ts` — O(n) single-pass construction, O(1) per-match lookup.
 */
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

    // Inside fenced block but not at line start (shouldn't normally happen
    // because we advance by full lines above, but safety net)
    if (inFencedCodeBlock) {
      mask[i] = 1;
      i += 1;
      continue;
    }

    // Inline code spans: backtick runs
    if (markdown[i] === "`") {
      let runLen = 1;
      while (i + runLen < len && markdown[i + runLen] === "`") {
        runLen += 1;
      }

      if (!inInlineCode) {
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
