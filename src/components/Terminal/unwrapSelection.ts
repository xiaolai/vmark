/**
 * unwrapTerminalSelection — "Copy unwrapped" for the integrated terminal.
 *
 * Programs that render to a TTY (codex and other Ink/TUI apps) hard-wrap
 * their output to the terminal width by emitting real `\n` characters.
 * xterm stores those as separate, non-`isWrapped` rows, so a normal copy
 * faithfully preserves them — there is no signal in the buffer to tell a
 * program's wrap newline from an intentional one.
 *
 * This is the opt-in escape hatch: the user selects what they know is one
 * logical flow, and we collapse the single newlines back into a paragraph.
 * Blank lines are the only paragraph signal we trust, so they are preserved
 * (collapsed to one break); consecutive non-blank lines are joined.
 *
 * Join spacing is CJK-aware: wrapped CJK text must join with NO space
 * (`在市场上\n搜索` → `在市场上搜索`), whereas Latin and Korean join with a
 * single space. We use a space unless either side of the break is a CJK
 * letter (Han / Kana / Bopomofo — Hangul is excluded because Korean uses
 * word spacing).
 *
 * @coordinates-with components/Terminal/TerminalContextMenu.tsx — "Copy unwrapped"
 * @coordinates-with lib/cjkFormatter/latinSpanScanner.ts — isCJKLetter
 * @module components/Terminal/unwrapSelection
 */

import { isCJKLetter } from "@/lib/cjkFormatter/latinSpanScanner";

/** Separator to splice two wrapped lines: "" across a CJK boundary, else " ".
 *  `left` and `right` are always non-empty here (blank lines are filtered by
 *  the caller); `charAt` returns "" for an empty string, so no nullish guard
 *  is needed and `isCJKLetter("")` is simply false. */
function joinSeparator(left: string, right: string): string {
  const lastChar = left.charAt(left.length - 1);
  const firstChar = right.charAt(0);
  if (isCJKLetter(lastChar) || isCJKLetter(firstChar)) return "";
  return " ";
}

/**
 * Join display-wrapped lines of a terminal selection into logical paragraphs.
 * Single newlines within a paragraph are removed (CJK-aware); blank lines
 * separate paragraphs and are preserved as a single break.
 */
export function unwrapTerminalSelection(text: string): string {
  // Strip only the trailing ASCII space / tab padding that xterm reports
  // for empty cells; meaningful Unicode whitespace such as the CJK
  // ideographic space (U+3000) is preserved. (Audit finding L1.)
  const lines = text.split(/\r?\n/).map((line) => line.replace(/[ \t]+$/, ""));

  const paragraphs: string[] = [];
  let current = "";

  for (const line of lines) {
    if (line === "") {
      // Blank line ends the current paragraph (consecutive blanks collapse).
      if (current !== "") {
        paragraphs.push(current);
        current = "";
      }
      continue;
    }
    if (current === "") {
      current = line;
    } else {
      current += joinSeparator(current, line) + line;
    }
  }
  if (current !== "") paragraphs.push(current);

  return paragraphs.join("\n\n");
}
