/**
 * Post-Format Integrity Verification
 *
 * Purpose: safety net that compares the document's CONTENT before and after
 * formatting. If it changed, formatting corrupted something — the caller
 * discards the result and returns the original text.
 *
 * Key decision: the check is a content SKELETON, not a list of substrings
 * (WI-CJKF6.1). It used to count occurrences of seven literals — `[^`, `<!--`,
 * ```` ``` ````, `~~~`, `$$`, `[[`, `` ` `` — which would not have caught a
 * single one of the ten defects the 2026-08-21 investigation found, while the
 * published guide claimed it "compares the visible text content … guarantees
 * that CJK formatting never silently loses content".
 *
 * The invariant that is actually available: **every legitimate rule in this
 * formatter changes only whitespace, punctuation, or the width of an
 * alphanumeric.** So NFKC-folding and then stripping whitespace and
 * punctuation leaves a string that must be IDENTICAL across a format run.
 * Letters, digits, ideographs, kana, hangul and emoji all survive into it, and
 * because it is a sequence rather than a count it catches reordering too.
 *
 * The substring counts are kept as a second, cheaper signal: they catch a lost
 * fence or backtick, which is punctuation and therefore invisible to the
 * skeleton.
 *
 * @coordinates-with formatter.ts — called after formatMarkdown to verify output
 * @module lib/cjkFormatter/integrity
 */

import { findCharacterReferences } from "./characterReferences";

export interface IntegrityResult {
  ok: boolean;
  details: Record<string, { before: number | string; after: number | string }>;
}

/**
 * Every HTML character reference in the text, in order.
 *
 * Re-exported from the ONE definition of the pattern so this check and the
 * parser's protection cannot drift apart — a checker stricter than the
 * detector would refuse runs the formatter never touched.
 */
export { findCharacterReferences as referenceInventory };

/**
 * Patterns to count. Each is a literal string that appears in structural
 * markdown and is made entirely of punctuation, so the skeleton cannot see it.
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

/**
 * `<br />` in its several spellings.
 *
 * `collapseNewlines` DELETES these, which is the one legitimate rule that
 * removes letters. Stripping them from both sides keeps that rule from
 * tripping the content check.
 */
const BR_TAG = /<br\s*\/?>/gi;

const WHITESPACE_OR_PUNCTUATION = /[\p{White_Space}\p{P}]/gu;

/**
 * The document's content, with everything the formatter is allowed to change
 * removed: whitespace, punctuation, and alphanumeric width.
 *
 * Symbols (`$`, `%`, `°`, emoji) are deliberately KEPT — no rule here alters
 * one, and keeping them is what makes a dropped emoji visible.
 */
export function contentSkeleton(text: string): string {
  return text
    .replace(BR_TAG, "")
    .normalize("NFKC")
    .replace(WHITESPACE_OR_PUNCTUATION, "");
}

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
 * Verify that formatting changed nothing but whitespace, punctuation and
 * character width.
 *
 * Returns `{ ok: true }` when the content skeleton and every structural count
 * match, or `{ ok: false, details }` naming what diverged.
 */
export function verifyIntegrity(before: string, after: string): IntegrityResult {
  const details: IntegrityResult["details"] = {};
  let ok = true;

  const beforeSkeleton = contentSkeleton(before);
  const afterSkeleton = contentSkeleton(after);
  if (beforeSkeleton !== afterSkeleton) {
    ok = false;
    // Lengths only. This runs over the user's document and the result reaches
    // their log file, which they attach to bug reports.
    details.content = { before: beforeSkeleton.length, after: afterSkeleton.length };
  }

  for (const pattern of STRUCTURAL_PATTERNS) {
    const beforeCount = countOccurrences(before, pattern);
    const afterCount = countOccurrences(after, pattern);

    if (beforeCount !== afterCount) {
      ok = false;
      details[pattern] = { before: beforeCount, after: afterCount };
    }
  }

  // Character references, as a THIRD signal, because the other two are both
  // blind to the defect in issue #1382. `&#x5176;实` → `&#x5176；实` stops
  // being a reference and starts being literal escaped text, but the skeleton
  // NFKC-folds `；` back to `;` and then strips it as punctuation, so the two
  // skeletons are identical; and no STRUCTURAL_PATTERNS literal appears in a
  // reference either. Protecting references in markdownParser.ts is the actual
  // fix — this is the net for the next rule that reaches one anyway, since
  // this formatter's history is that exactly that keeps happening.
  const beforeRefs = findCharacterReferences(before);
  const afterRefs = findCharacterReferences(after);
  const refsDiffer =
    beforeRefs.length !== afterRefs.length ||
    beforeRefs.some((ref, i) => ref !== afterRefs[i]);
  if (refsDiffer) {
    ok = false;
    // Counts, not the references themselves: this reaches the user's log.
    details.characterReferences = { before: beforeRefs.length, after: afterRefs.length };
  }

  return { ok, details };
}
