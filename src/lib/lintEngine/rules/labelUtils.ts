/**
 * CommonMark label normalization utilities.
 *
 * Purpose: Shared helpers for the reference rules — normalizing labels per the
 * CommonMark spec (case-insensitive, whitespace-collapsed), and telling an
 * escaped bracket from a real one. Both rules scan the SAME shapes with the
 * same regex, so a helper here is what keeps them from disagreeing about one
 * document.
 */

/**
 * Normalize a CommonMark reference label.
 * Lowercase + collapse internal whitespace + trim.
 */
export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Whether the character at `index` is escaped — preceded by an ODD run of
 * backslashes.
 *
 * `\[text][label]` is a literal `[text]` followed by a shortcut reference, not
 * a full reference to `label`; reporting one was a false positive on exactly
 * the shape a document uses to WRITE about markdown (audit 20260907 round 2).
 * The run is counted rather than one character tested, because `\\[a]` is an
 * escaped BACKSLASH followed by a real bracket.
 */
export function isEscapedAt(line: string, index: number): boolean {
  let run = 0;
  while (index - run - 1 >= 0 && line.charAt(index - run - 1) === "\\") run += 1;
  return run % 2 === 1;
}
