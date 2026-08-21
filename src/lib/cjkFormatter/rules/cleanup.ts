/**
 * Group 5 — Cleanup rules (consecutive punctuation limits, trailing spaces).
 *
 * @coordinates-with ../types.ts — FormatOptions carries the segment edge flags
 * @module lib/cjkFormatter/rules/cleanup
 */

import type { FormatOptions } from "../types";

/** Limit consecutive punctuation marks. */
export function limitConsecutivePunctuation(
  text: string,
  limit: number
): string {
  if (limit === 0) return text;

  const marks = ["！", "？", "。"];
  for (const mark of marks) {
    const escaped = mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (limit === 1) {
      text = text.replace(new RegExp(`${escaped}{2,}`, "g"), mark);
    } else if (limit === 2) {
      text = text.replace(new RegExp(`${escaped}{3,}`, "g"), mark + mark);
    }
  }
  return text;
}

/**
 * Remove trailing spaces at end of lines.
 *
 * `options.endsAtLineEnd === false` means the LAST line of `text` does not end
 * a line in the enclosing document — a protected region follows it on the same
 * line. Its trailing spaces are ordinary inter-word spaces, not end-of-line
 * junk, and deleting them is what turned `使用 \`printf\` 函数` into
 * `使用\`printf\` 函数` (WI-CJKF2.1).
 */
export function removeTrailingSpaces(
  text: string,
  options: FormatOptions = {}
): string {
  const {
    preserveTwoSpaceHardBreaks = false,
    endsAtLineEnd = true,
    startsAtLineStart = true,
  } = options;

  const lines = text.split("\n");
  const lastIndex = lines.length - 1;

  const processed = lines.map((line, index) => {
    if (index === lastIndex && !endsAtLineEnd) return line;

    let lineEnding = "";
    let content = line;

    if (content.endsWith("\r")) {
      lineEnding = "\r";
      content = content.slice(0, -1);
    }

    const trailingMatch = content.match(/ +$/);
    if (!trailingMatch) return content + lineEnding;

    const trailingSpaces = trailingMatch[0];
    const before = content.slice(0, -trailingSpaces.length);

    // Two or more spaces after real content is a markdown HARD BREAK. Under
    // the "twoSpaces" convention that is syntax, not whitespace.
    //
    // "After real content" cannot be judged from the segment alone: in
    // `中文 \`code\`  \n` the break sits at the very start of the segment that
    // follows the code span, so `before` is empty even though the line is not.
    // The first line of a segment that does not begin a line always has
    // content to its left, outside the segment.
    const hasContentToTheLeft =
      before.trim().length > 0 || (index === 0 && !startsAtLineStart);

    if (
      preserveTwoSpaceHardBreaks &&
      trailingSpaces.length >= 2 &&
      hasContentToTheLeft
    ) {
      return content + lineEnding;
    }

    return before + lineEnding;
  });

  return processed.join("\n");
}
