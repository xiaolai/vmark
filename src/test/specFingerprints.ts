/**
 * Exact divergence fingerprints for the spec gates.
 *
 * Purpose: a declaration that says only "this example diverges" suppresses
 * everything that happens at that example afterwards. Once `cm-527` was
 * declared for reference-link resolution, a NEW corruption of `cm-527` —
 * a dropped title, a reordered child, a changed URL — kept the gate green,
 * because the gate only asked `divergences.length > 0`.
 *
 * The repository already had the right model in
 * `conformance/expectedDeltas.ts`: pin path, kind, detail and BOTH values,
 * and compare structurally. This generalizes that model for the two spec
 * gates rather than inventing a second, weaker one.
 *
 * Comparison is an exact MULTISET match, one-to-one. A subset check would
 * let one expected entry satisfy several actual divergences, which is the
 * same wildcard suppression by another route.
 *
 * @coordinates-with utils/markdownPipeline/conformance/expectedDeltas.ts — the model
 * @coordinates-with utils/markdownPipeline/conformance/semanticProjection.ts — sameValue
 * @module test/specFingerprints
 */
import {
  sameValue,
} from "@/utils/markdownPipeline/conformance/semanticProjection";
import {
  type Divergence,
} from "@/utils/markdownPipeline/conformance/projectionDiff";

/** One pinned difference. Values included, so a NEW difference cannot hide. */
export interface ExpectedDivergence {
  path: string;
  kind: Divergence["kind"];
  detail: string;
  leftValue: unknown;
  rightValue: unknown;
}

/** Fingerprints keyed by example id. */
export type FingerprintMap = Readonly<Record<string, readonly ExpectedDivergence[]>>;

/** The comparable form of an observed divergence. */
export function fingerprintOf(d: Divergence): ExpectedDivergence {
  return {
    path: d.path,
    kind: d.kind,
    detail: d.detail,
    leftValue: d.documentValue,
    rightValue: d.sourcePositionValue,
  };
}

function same(a: ExpectedDivergence, b: ExpectedDivergence): boolean {
  return (
    a.path === b.path &&
    a.kind === b.kind &&
    a.detail === b.detail &&
    sameValue(a.leftValue, b.leftValue) &&
    sameValue(a.rightValue, b.rightValue)
  );
}

export interface FingerprintComparison {
  /** Observed but not declared — a NEW divergence on a declared example. */
  unexpected: ExpectedDivergence[];
  /** Declared but no longer observed — a stale pin. */
  missing: ExpectedDivergence[];
}

/**
 * Exact one-to-one comparison. Each expected entry is consumed by at most
 * one actual divergence, so duplicates are counted rather than collapsed.
 */
export function compareFingerprints(
  actual: readonly Divergence[],
  expected: readonly ExpectedDivergence[],
): FingerprintComparison {
  const remaining = [...expected];
  const unexpected: ExpectedDivergence[] = [];

  for (const divergence of actual) {
    const fp = fingerprintOf(divergence);
    const idx = remaining.findIndex((e) => same(e, fp));
    if (idx === -1) unexpected.push(fp);
    else remaining.splice(idx, 1);
  }

  return { unexpected, missing: remaining };
}

/** Human-readable rendering for a failure message. */
export function describeFingerprints(
  entries: readonly ExpectedDivergence[],
): string {
  return entries
    .slice(0, 5)
    .map(
      (e) =>
        `    ${e.path} [${e.kind}] ${e.detail}` +
        ` (left=${JSON.stringify(e.leftValue)} right=${JSON.stringify(e.rightValue)})`,
    )
    .join("\n");
}
