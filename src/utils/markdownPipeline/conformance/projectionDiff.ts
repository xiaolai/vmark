/**
 * Comparison half of the semantic projection.
 *
 * `semanticProjection.ts` decides WHAT is semantic; this decides how two
 * projections differ. Split when the pair outgrew the 300-line limit —
 * projection and comparison are separate responsibilities that happened to
 * share a file.
 *
 * @coordinates-with semanticProjection.ts — project()/sameValue()
 * @coordinates-with parserConformance.test.ts — the gate
 * @module utils/markdownPipeline/conformance/projectionDiff
 */
import { sameValue, type ProjectedNode } from "./semanticProjection";

/** A single point of difference between two projections. */
export interface Divergence {
  /** Dotted child path from the root, e.g. `root.children[0].children[1]`. */
  path: string;
  kind: "type" | "attribute" | "child-count" | "missing";
  detail: string;
  documentValue: unknown;
  sourcePositionValue: unknown;
}

/** Every way two projections differ. Empty means identical. */
export function diff(
  documentTree: ProjectedNode | undefined,
  sourceTree: ProjectedNode | undefined,
  path = "root"
): Divergence[] {
  // Both absent is not a difference — "empty means identical" is the contract.
  if (!documentTree && !sourceTree) return [];

  if (!documentTree || !sourceTree) {
    return [
      {
        path,
        kind: "missing",
        detail: documentTree ? "absent in source-position" : "absent in document",
        documentValue: documentTree?.type,
        sourcePositionValue: sourceTree?.type,
      },
    ];
  }

  const out: Divergence[] = [];

  if (documentTree.type !== sourceTree.type) {
    out.push({
      path,
      kind: "type",
      detail: `${documentTree.type} vs ${sourceTree.type}`,
      documentValue: documentTree.type,
      sourcePositionValue: sourceTree.type,
    });
    // Do NOT stop here. Stopping buried every descendant difference beneath a
    // node whose type diverged — and a type divergence can be DECLARED, so a
    // subtree delta would have suppressed real changes underneath it without
    // anyone seeing them. That is the vacuous-gate failure this module exists
    // to avoid.
    //
    // Attributes are skipped (unrelated shapes have unrelated fields), but
    // children are still compared by index.
    //
    // KNOWN GAP, deliberately left to the ledger layer: a declared type flip
    // (linkReference→link) also hides a changed `url` or `title` on that same
    // node. The spec tier's exact-signature ledgers pin the type row's values
    // but cannot see attributes `diff` never emits. Widening this primitive
    // was tried and reverted — every ledger in the spec tier is measured
    // against this contract, so changing it here re-authors those ledgers
    // blind. Close it in the ledger layer, or with a targeted assertion.
    return [...out, ...diffChildren(documentTree, sourceTree, path)];
  }

  const keys = new Set([
    ...Object.keys(documentTree.attributes),
    ...Object.keys(sourceTree.attributes),
  ]);
  for (const key of [...keys].sort()) {
    const a = documentTree.attributes[key];
    const b = sourceTree.attributes[key];
    if (!sameValue(a, b)) {
      out.push({
        path,
        kind: "attribute",
        detail: key,
        documentValue: a,
        sourcePositionValue: b,
      });
    }
  }

  if (documentTree.children.length !== sourceTree.children.length) {
    out.push({
      path,
      kind: "child-count",
      detail: `${documentTree.children.length} vs ${sourceTree.children.length}`,
      documentValue: documentTree.children.length,
      sourcePositionValue: sourceTree.children.length,
    });
  }

  return [...out, ...diffChildren(documentTree, sourceTree, path)];
}

/** Compare children by index. Extra children on either side are reported. */
function diffChildren(
  documentTree: ProjectedNode,
  sourceTree: ProjectedNode,
  path: string
): Divergence[] {
  const out: Divergence[] = [];
  // Walk the LONGER side: children beyond the shorter one were previously
  // invisible, so a tree with extra nodes reported only a count difference and
  // nothing about what those nodes were.
  const longest = Math.max(documentTree.children.length, sourceTree.children.length);
  for (let i = 0; i < longest; i += 1) {
    out.push(
      ...diff(
        documentTree.children[i],
        sourceTree.children[i],
        `${path}.children[${i}]`,
      )
    );
  }
  return out;
}
