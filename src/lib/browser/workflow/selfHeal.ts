/**
 * Workflow self-healing — propose a locator fix when a step's target moves
 * (WI-4.4 / R8a / WI-NB6.4 / P-3).
 *
 * WIRED: `services/workflow/runExecutor.ts` calls this after a not-found act and
 * re-enters the approval gate with the healed descriptor (P-3): a standing grant
 * for that op+origin covers it; anything else raises a NEW prompt showing the
 * healed role+name, and the old one-shot cannot match it (Rust target binding).
 *
 * Purpose: sites change their markup and a role+name locator that used to match
 * stops matching. Rather than fail hard, this proposes the most similar
 * same-role element in the *current* page snapshot as a candidate fix, with a
 * confidence score. This module only ranks candidates; the approval gate decides.
 *
 * Confidence is a normalized edit-distance similarity on the accessible name;
 * the role must match exactly (a locator never heals across roles — a button is
 * not repaired to a link).
 *
 * **Antonyms are never a heal** (audit 2026-09-03 W-03). Heal fires when the
 * original target is ABSENT — which is exactly the page state after the action
 * already happened, where the inverse control ("Unpublish" for "Publish",
 * "Unsubscribe" for "Subscribe") now stands in its place and scores 0.75–0.82 on
 * edit distance. Under a standing grant that would run the inverse action with no
 * prompt. So a candidate whose normalised name is the failed name with an added
 * PREFIX is rejected outright, whatever it scores; and a candidate that does not
 * START with the failed name (a typo, a different word) must clear 0.85, while
 * suffix/decoration drift ("Publish now", "Publish…") keeps the 0.6 floor.
 * Names are compared with Unicode format characters stripped (`\p{Cf}`: zero-width
 * joiners, bidi overrides), so a mark the user cannot see cannot disguise one.
 *
 * A proposal must be UNAMBIGUOUS, because the executor resolves a role+name locator
 * to the FIRST matching element: a tie between two candidates, or a winning name that
 * occurs twice with that role, means the repaired locator would still not identify one
 * element — so nothing is proposed rather than a coin-flip target.
 *
 * @coordinates-with lib/browser/agent/aria.ts — snapshot nodes ARE `AriaNode`s
 * @coordinates-with services/workflow/runExecutor.ts — the caller, post not-found
 * @module lib/browser/workflow/selfHeal
 */
import type { AriaNode } from "../agent/aria";

/** A role + accessible-name locator. */
export interface Locator {
  role: string;
  name: string;
}

/** A node from the page ARIA snapshot — derived from `AriaNode`, so the two cannot
 *  drift apart (the snapshot is literally what `ariaSnapshot` produces). */
export type SnapshotNode = Pick<AriaNode, "role" | "name">;

/** A proposed replacement locator with a 0..1 confidence. */
export interface LocatorProposal extends Locator {
  confidence: number;
}

/**
 * Accessible names come from page content, and the distance below is quadratic. A
 * "name" longer than this is not a usable locator anyway (and comparing two of them
 * would block the UI thread), so such candidates are never healed.
 */
const MAX_NAME_LEN = 512;

/** Confidence a candidate must clear when the failed name is NOT a prefix of it
 *  (a typo or a different word, as opposed to decoration appended to the same name). */
const NON_PREFIX_FLOOR = 0.85;

/** Normalize for comparison: NFC (so `café` composed and decomposed are the same
 *  text), format characters removed (`\p{Cf}` — a zero-width or bidi mark is not
 *  drift, and must not disguise a prefix), case-folded, and split into CODE POINTS —
 *  an emoji is one character, not two surrogate halves that distort the score. */
function normalize(name: string): string[] {
  return Array.from(name.normalize("NFC").replace(/\p{Cf}/gu, "").trim().toLowerCase());
}

/** Whether `candidate` starts with every code point of `prefix`. */
function startsWith(candidate: readonly string[], prefix: readonly string[]): boolean {
  if (candidate.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) if (candidate[i] !== prefix[i]) return false;
  return true;
}

/** Whether `candidate` is `failed` with something PREPENDED ("Unpublish" for
 *  "publish", "Cancel publish"). Such a name is an inverse or a different action,
 *  never a decoration of the same one. */
function isPrefixedForm(candidate: readonly string[], failed: readonly string[]): boolean {
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
function editDistance(a: readonly string[], b: readonly string[], maxDistance: number): number {
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
function nameSimilarity(a: readonly string[], b: readonly string[], minConfidence: number): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  // confidence ≥ min ⟺ distance ≤ (1 - min) · max. The epsilon absorbs float error
  // so an exactly-at-threshold candidate is not rejected by a rounding artifact.
  const maxDistance = Math.floor((1 - minConfidence) * max + 1e-9);
  return 1 - editDistance(a, b, maxDistance) / max;
}

/**
 * Propose the best same-role replacement for a `failed` locator from the current
 * `snapshot`, or null when nothing clears the floor — `minConfidence` (default 0.6)
 * for a candidate that starts with the failed name, 0.85 otherwise — or the best
 * candidate is ambiguous (a tie, or a name shared by several same-role nodes), or
 * the only candidates are prefixed (antonym) forms. Never heals across roles.
 */
export function proposeLocatorFix(
  failed: Locator,
  snapshot: readonly SnapshotNode[],
  options: { minConfidence?: number } = {},
): LocatorProposal | null {
  const minConfidence = options.minConfidence ?? 0.6;
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new RangeError(`minConfidence must be a number within [0,1] (got ${minConfidence}).`);
  }

  const failedName = normalize(failed.name);
  if (failedName.length > MAX_NAME_LEN) return null;

  /** How many same-role nodes carry each name — a repaired locator must match one. */
  const occurrences = new Map<string, number>();
  let best: LocatorProposal | null = null;
  let tied = false;

  for (const node of snapshot) {
    if (node.role !== failed.role) continue;
    occurrences.set(node.name, (occurrences.get(node.name) ?? 0) + 1);

    const candidate = normalize(node.name);
    if (candidate.length > MAX_NAME_LEN) continue;
    // W-03: the inverse control is the failed name with a prefix — never a heal.
    if (isPrefixedForm(candidate, failedName)) continue;
    // Decoration appended to the same name keeps the caller's floor; anything
    // else (a typo, another word) must be nearly identical.
    const floor = startsWith(candidate, failedName) ? minConfidence : Math.max(minConfidence, NON_PREFIX_FLOOR);
    const confidence = nameSimilarity(failedName, candidate, floor);
    if (confidence < floor) continue;

    if (!best || confidence > best.confidence) {
      best = { role: node.role, name: node.name, confidence };
      tied = false;
    } else if (confidence === best.confidence && node.name !== best.name) {
      tied = true; // two DIFFERENT names score the same — pick neither
    }
  }

  if (!best || tied) return null;
  if ((occurrences.get(best.name) ?? 0) > 1) return null; // locator would match several elements
  return best;
}
