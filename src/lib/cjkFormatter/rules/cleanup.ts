/**
 * Group 5 — Cleanup rules (consecutive punctuation limits, trailing spaces).
 *
 * @module lib/cjkFormatter/rules/cleanup
 */

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

/** Remove trailing spaces at end of lines. */
export function removeTrailingSpaces(
  text: string,
  options: { preserveTwoSpaceHardBreaks?: boolean } = {}
): string {
  if (!options.preserveTwoSpaceHardBreaks) {
    return text.replace(/ +$/gm, "");
  }

  const lines = text.split("\n");
  const processed = lines.map((line) => {
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

    if (trailingSpaces.length >= 2 && before.trim().length > 0) {
      return content + lineEnding;
    }

    return before + lineEnding;
  });

  return processed.join("\n");
}
