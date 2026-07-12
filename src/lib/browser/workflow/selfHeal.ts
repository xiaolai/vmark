/**
 * Workflow self-healing — propose a locator fix when a step's target moves
 * (WI-4.4 / R8a).
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
 * @coordinates-with lib/browser/agent/aria.ts — snapshot node shape (role,name)
 * @coordinates-with lib/browser/workflow/engine.ts — a paused step can offer this
 * @module lib/browser/workflow/selfHeal
 */

/** A role + accessible-name locator. */
export interface Locator {
  role: string;
  name: string;
}

/** A node from the page ARIA snapshot (role + accessible name). */
export interface SnapshotNode {
  role: string;
  name: string;
}

/** A proposed replacement locator with a 0..1 confidence. */
export interface LocatorProposal extends Locator {
  confidence: number;
}

/** Levenshtein edit distance (iterative, single-row). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Case-insensitive normalized name similarity in [0,1] (1 = identical). */
function nameSimilarity(a: string, b: string): number {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  const max = Math.max(x.length, y.length);
  if (max === 0) return 1;
  return 1 - editDistance(x, y) / max;
}

/**
 * Propose the best same-role replacement for a `failed` locator from the current
 * `snapshot`, or null if nothing clears `minConfidence` (default 0.6). Never
 * heals across roles.
 */
export function proposeLocatorFix(
  failed: Locator,
  snapshot: readonly SnapshotNode[],
  options: { minConfidence?: number } = {},
): LocatorProposal | null {
  const minConfidence = options.minConfidence ?? 0.6;
  let best: LocatorProposal | null = null;
  for (const node of snapshot) {
    if (node.role !== failed.role) continue;
    const confidence = nameSimilarity(failed.name, node.name);
    if (confidence >= minConfidence && (!best || confidence > best.confidence)) {
      best = { role: node.role, name: node.name, confidence };
    }
  }
  return best;
}
