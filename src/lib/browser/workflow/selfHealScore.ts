/**
 * Self-heal candidate scoring (WI-4.4 / W-03; split out of selfHeal.ts in audit
 * r3 #145) — how similar a snapshot node's accessible name is to a failed
 * locator's, and the confidence floor that candidate must clear.
 *
 * Confidence is a normalized edit-distance similarity on the accessible name.
 * Names are compared NFC-normalized, with Unicode format characters stripped
 * (`\p{Cf}`: zero-width joiners, bidi overrides — a mark the user cannot see
 * cannot disguise a candidate), whitespace collapsed, case-folded, and split into
 * CODE POINTS, so an emoji is one character rather than two surrogate halves.
 *
 * **Antonyms are never a heal** (audit 2026-09-03 W-03). Heal fires when the
 * original target is ABSENT — exactly the page state after the action already
 * happened, where the inverse control ("Unpublish" for "Publish", "Unsubscribe"
 * for "Subscribe") stands in its place and scores 0.75–0.82 on edit distance.
 * Under a standing grant that would run the inverse action with no prompt. So a
 * candidate whose normalised name is the failed name with an added PREFIX is
 * rejected outright, whatever it scores; a candidate that does not START with the
 * failed name (a typo, a different word) must clear `NON_PREFIX_FLOOR`; and
 * suffix/decoration drift ("Publish now", "Publish…") keeps the caller's floor —
 * for a READ. A write (`policy.write`) holds the strict floor for prefix
 * candidates too: "Delete" healing to "Delete all" under a standing grant is a
 * different action.
 *
 * Leaf-pure; `selfHeal.ts` composes these over a snapshot and decides ambiguity.
 *
 * @coordinates-with lib/browser/agent/ariaName.ts — the SAME normalization the snapshot applies to names
 * @coordinates-with lib/browser/workflow/selfHeal.ts — the consumer
 * @module lib/browser/workflow/selfHealScore
 */
import { normalize as ariaNormalize } from "../agent/ariaName";

/** A name prepared for comparison: normalized, case-folded, split into code points. */
export type NormalizedName = readonly string[];

/** What the caller is healing: its floor, and whether the step is a WRITE. */
export interface HealPolicy {
  readonly minConfidence: number;
  readonly write: boolean;
}

/**
 * Accessible names come from page content, and the distance below is quadratic. A
 * "name" longer than this is not a usable locator anyway (and comparing two of them
 * would block the UI thread), so such candidates are never healed.
 */
export const MAX_NAME_LEN = 512;

/** Confidence a candidate must clear when the failed name is NOT a prefix of it
 *  (a typo or a different word, as opposed to decoration appended to the same name). */
export const NON_PREFIX_FLOOR = 0.85;

/** Normalize for comparison: the SAME normalization the ARIA snapshot applies to the
 *  names it produces (NFC, format characters removed, whitespace collapsed — a local
 *  copy had drifted), then case-folded and split into code points. */
export function normalizeName(name: string): string[] {
  return Array.from(ariaNormalize(name).toLowerCase());
}

/** Whether `candidate` starts with every code point of `prefix`. */
function startsWith(candidate: NormalizedName, prefix: NormalizedName): boolean {
  if (candidate.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) if (candidate[i] !== prefix[i]) return false;
  return true;
}

/** Whether `candidate` is `failed` with something PREPENDED ("Unpublish" for
 *  "publish", "Cancel publish"). Such a name is an inverse or a different action,
 *  never a decoration of the same one. */
function isPrefixedForm(candidate: NormalizedName, failed: NormalizedName): boolean {
  if (failed.length === 0 || candidate.length <= failed.length) return false;
  const offset = candidate.length - failed.length;
  for (let i = 0; i < failed.length; i += 1) if (candidate[offset + i] !== failed[i]) return false;
  return true;
}

/**
 * Levenshtein edit distance over code points, abandoned as soon as every cell in a
 * row exceeds `maxDistance` (the caller only needs to know the candidate cannot clear
 * the bar — this keeps a hostile page's many long names from burning the CPU).
 */
function editDistance(a: NormalizedName, b: NormalizedName, maxDistance: number): number {
  // The distance is at least the length difference — reject without any DP work.
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    prev = curr;
  }
  return prev[b.length];
}

/** Name similarity in [0,1] (1 = identical). Anything below `minConfidence` is only
 *  guaranteed to be below it — the exact value is not computed. */
function nameSimilarity(a: NormalizedName, b: NormalizedName, minConfidence: number): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  // confidence ≥ min ⟺ distance ≤ (1 - min) · max. The epsilon absorbs float error
  // so an exactly-at-threshold candidate is not rejected by a rounding artifact.
  const maxDistance = Math.floor((1 - minConfidence) * max + 1e-9);
  return 1 - editDistance(a, b, maxDistance) / max;
}

/**
 * The floor `candidate` must clear. Decoration appended to the same name keeps the
 * caller's floor; anything else (a typo, another word) must be nearly identical. A
 * WRITE never heals on the permissive prefix floor: "Delete" healing to "Delete all"
 * under a standing grant is a different action, not decoration.
 */
export function candidateFloor(candidate: NormalizedName, failed: NormalizedName, policy: HealPolicy): number {
  const strict = Math.max(policy.minConfidence, NON_PREFIX_FLOOR);
  if (!startsWith(candidate, failed)) return strict;
  return policy.write ? strict : policy.minConfidence;
}

/**
 * Score one same-role candidate against the failed name: its confidence when it is
 * an admissible heal, or null when it is not — an over-long name on either side, a
 * prefixed (antonym) form, or a similarity below its floor.
 */
export function scoreCandidate(failed: NormalizedName, candidate: NormalizedName, policy: HealPolicy): number | null {
  if (failed.length > MAX_NAME_LEN || candidate.length > MAX_NAME_LEN) return null;
  // W-03: the inverse control is the failed name with a prefix — never a heal.
  if (isPrefixedForm(candidate, failed)) return null;
  const floor = candidateFloor(candidate, failed, policy);
  const confidence = nameSimilarity(failed, candidate, floor);
  return confidence < floor ? null : confidence;
}
