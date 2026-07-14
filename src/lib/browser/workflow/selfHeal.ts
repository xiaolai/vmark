/**
 * Workflow self-healing — propose a locator fix when a step's target moves
 * (WI-4.4 / R8a).
 *
 * ⚠️ **NOT WIRED — no production caller.** A repair re-targets an action to a DIFFERENT
 * same-role element than the one the user approved — exactly the escalation the one-shot
 * target binding defends against. A healed target MUST pass a fresh approval gate before
 * this is wired; today it returns an ordinary proposal with no such requirement. (Branch
 * audit.)
 *
 * Purpose: sites change their markup and a role+name locator that used to match
 * stops matching. Rather than fail hard, this proposes the most similar
 * same-role element in the *current* page snapshot as a candidate fix, with a
 * confidence score. A proposal is never applied silently: per R8a a repair is a
 * NEW operation that must be re-approved (a write repair especially) — this
 * module only ranks candidates; the human/approval gate decides.
 *
 * Confidence is a normalized edit-distance similarity on the accessible name;
 * the role must match exactly (a locator never heals across roles — a button is
 * not repaired to a link).
 *
 * A proposal must be UNAMBIGUOUS, because the executor resolves a role+name locator
 * to the FIRST matching element: a tie between two candidates, or a winning name that
 * occurs twice with that role, means the repaired locator would still not identify one
 * element — so nothing is proposed rather than a coin-flip target.
 *
 * @coordinates-with lib/browser/agent/aria.ts — snapshot nodes ARE `AriaNode`s
 * @coordinates-with lib/browser/workflow/engine.ts — a paused step can offer this
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

/** Normalize for comparison: NFC (so `café` composed and decomposed are the same
 *  text), case-folded, and split into CODE POINTS — an emoji is one character, not
 *  two surrogate halves that distort the score. */
function normalize(name: string): string[] {
  return Array.from(name.normalize("NFC").trim().toLowerCase());
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
 * `snapshot`, or null when nothing clears `minConfidence` (default 0.6) or the best
 * candidate is ambiguous (a tie, or a name shared by several same-role nodes). Never
 * heals across roles.
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
    const confidence = nameSimilarity(failedName, candidate, minConfidence);
    if (confidence < minConfidence) continue;

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
