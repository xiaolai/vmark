/**
 * Post-Format Integrity Verification
 *
 * Purpose: Safety net that counts structural markdown patterns before and after
 * formatting. If any count changes, formatting corrupted something — the caller
 * should discard the result and return the original text.
 *
 * This is defense-in-depth. The segment-based architecture should prevent all
 * corruption, but this catches bugs in the parser itself.
 *
 * Inspired by the Glean CJK formatter's integrity check system.
 *
 * @coordinates-with formatter.ts — called after formatMarkdown to verify output
 * @module lib/cjkFormatter/integrity
 */

export interface IntegrityResult {
  ok: boolean;
  details: Record<string, { before: number; after: number }>;
}

/**
 * Patterns to count. Each is a literal string that appears in structural markdown.
 * We count occurrences in both before and after text — any difference means corruption.
 */
const STRUCTURAL_PATTERNS = [
  "[^",   // footnote references and definitions
  "<!--", // HTML comments
  "```",  // fenced code blocks (backtick style)
  "~~~",  // fenced code blocks (tilde style)
  "$$",   // math blocks (display math delimiters)
  "[[",   // wiki links
  "`",    // inline code backticks (catches lost inline code)
] as const;

function countOccurrences(text: string, pattern: string): number {
  let count = 0;
  let pos = 0;
  while (pos < text.length) {
    const idx = text.indexOf(pattern, pos);
    if (idx === -1) break;
    count++;
    pos = idx + pattern.length;
  }
  return count;
}

/**
 * Verify that formatting did not lose or gain structural patterns.
 *
 * Returns { ok: true } if all pattern counts match, or { ok: false, details }
 * with the mismatched counts.
 */
export function verifyIntegrity(before: string, after: string): IntegrityResult {
  const details: Record<string, { before: number; after: number }> = {};
  let ok = true;

  for (const pattern of STRUCTURAL_PATTERNS) {
    const beforeCount = countOccurrences(before, pattern);
    const afterCount = countOccurrences(after, pattern);

    if (beforeCount !== afterCount) {
      ok = false;
      details[pattern] = { before: beforeCount, after: afterCount };
    }
  }

  return { ok, details };
}
