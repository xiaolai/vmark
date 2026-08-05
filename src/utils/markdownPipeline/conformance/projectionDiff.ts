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
/** Optional comparison behaviours. Defaults preserve the original contract. */
export interface DiffOptions {
  /**
   * On a node-TYPE divergence, also emit both attribute sets as one entry.
   *
   * Off by default: `parserConformance` compares two parses of the SAME text
   * and treats unrelated shapes as having unrelated fields. The spec gates
   * turn it on because they PIN declared divergences, where a silent change
   * to a resolved `url` inside a declared type flip is exactly the drift the
   * fingerprints exist to catch.
   */
  pinAttributesAcrossTypes?: boolean;
}

export function diff(
  documentTree: ProjectedNode | undefined,
  sourceTree: ProjectedNode | undefined,
  path = "root",
  options: DiffOptions = {}
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
    // Attributes are still compared across a type change. Skipping them
    // entirely meant a declared flip (linkReference→link) also hid a changed
    // `url` or `title`, so a resolved destination could drift invisibly.
    return [
      ...out,
      ...diffSharedAttributes(documentTree, sourceTree, path),
      // Shared keys are not enough on their own: `link` carries url/title
      // while `linkReference` carries identifier/label/referenceType, so the
      // commonest declared flip has NO overlap and a changed resolved URL
      // would stay invisible. The spec gates opt in to pinning both
      // attribute sets whole; the default stays as parserConformance has
      // always defined it.
      ...(options.pinAttributesAcrossTypes
        ? [
            {
              path,
              kind: "attribute" as const,
              detail: "«attributes across a type change»",
              documentValue: documentTree.attributes,
              sourcePositionValue: sourceTree.attributes,
            },
          ]
        : []),
      ...diffChildren(documentTree, sourceTree, path, options),
    ];
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

  return [...out, ...diffChildren(documentTree, sourceTree, path, options)];
}

/** Compare only the attribute keys BOTH shapes carry. */
function diffSharedAttributes(
  documentTree: ProjectedNode,
  sourceTree: ProjectedNode,
  path: string
): Divergence[] {
  const out: Divergence[] = [];
  const shared = Object.keys(documentTree.attributes)
    .filter((k) => Object.hasOwn(sourceTree.attributes, k))
    .sort();
  for (const key of shared) {
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
  return out;
}

/** Compare children by index. Extra children on either side are reported. */
function diffChildren(
  documentTree: ProjectedNode,
  sourceTree: ProjectedNode,
  path: string,
  options: DiffOptions = {}
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
        options
      )
    );
  }
  return out;
}
