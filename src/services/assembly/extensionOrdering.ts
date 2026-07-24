/**
 * Total-order pinning for the two composition roots (WI-3.4, ADR-015 D1).
 *
 * Purpose: turn a root's single canonical id list into the explicit `after`
 *   constraints the extension resolver consumes, so the physical extension array
 *   can be alphabetical (array position NOT load-bearing) while resolution still
 *   reproduces the canonical order exactly — and provably, regardless of the
 *   array's declaration order.
 *
 * Why a canonical list + derived constraints, not 126 inline annotations: the
 *   order lives in ONE auditable place per root, and drift (an extension added
 *   to the array but not the list, or vice versa) is caught by a set-equality
 *   guard rather than a silently-unpinned entry.
 *
 * Constraints chain over the PRESENT ids only. A conditionally-absent entry
 *   (lint without a tabId; workflow extensions when the feature flag is off)
 *   must never be named by an `after` — the resolver rejects a dangling
 *   reference — so each present entry is pinned after the nearest PRESENT
 *   predecessor, skipping absent ones.
 *
 * @coordinates-with lib/extensions/resolve.ts — consumes the `after` constraints
 * @coordinates-with tiptapExtensions.ts, sourceEditorExtensions.ts — the roots
 * @module services/assembly/extensionOrdering
 */

/**
 * Derive `{ id → [predecessorId] }` `after` constraints that pin `presentIds`
 * into `canonicalOrder`. Each present id is chained after the nearest present id
 * that precedes it in the canonical order; the first present id gets none.
 * Ids present but absent from the canonical order are returned unpinned (the
 * caller's guard is responsible for rejecting that drift).
 */
export function deriveAfterConstraints(
  canonicalOrder: readonly string[],
  presentIds: Iterable<string>,
): Map<string, readonly string[]> {
  const present = new Set(presentIds);
  const out = new Map<string, readonly string[]>();
  let prev: string | null = null;
  for (const id of canonicalOrder) {
    if (!present.has(id)) continue;
    if (prev !== null) out.set(id, [prev]);
    prev = id;
  }
  return out;
}

/**
 * Fail-loud guard: every present id must appear in the canonical order and vice
 * versa (modulo `optional` ids, which may be absent from `presentIds` but must
 * still be declared in the canonical order). Throws with the exact drift so a
 * forgotten canonical-list update surfaces at composition time, not as a subtle
 * reordering. Returns nothing; throws `Error` on mismatch.
 */
export function assertCanonicalCoverage(
  root: string,
  canonicalOrder: readonly string[],
  presentIds: Iterable<string>,
  optional: readonly string[] = [],
): void {
  const canonical = new Set(canonicalOrder);
  const optionalSet = new Set(optional);
  const present = new Set(presentIds);

  const missingFromCanonical = [...present].filter((id) => !canonical.has(id));
  const missingFromPresent = [...canonical].filter(
    (id) => !present.has(id) && !optionalSet.has(id),
  );
  const dupes = canonicalOrder.filter((id, i) => canonicalOrder.indexOf(id) !== i);

  if (missingFromCanonical.length || missingFromPresent.length || dupes.length) {
    throw new Error(
      `${root} composition order drift:` +
        (missingFromCanonical.length
          ? `\n  present but not in canonical order: ${missingFromCanonical.join(", ")}`
          : "") +
        (missingFromPresent.length
          ? `\n  in canonical order but absent (and not optional): ${missingFromPresent.join(", ")}`
          : "") +
        (dupes.length ? `\n  duplicated in canonical order: ${dupes.join(", ")}` : ""),
    );
  }
}
