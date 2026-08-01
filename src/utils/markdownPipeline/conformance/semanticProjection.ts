/**
 * Purpose: project an mdast tree to the shape two parse modes must agree on.
 *
 * "Normalised semantic projection" is not a specification. An implementation
 * can keep discarding values, attributes, nesting or ordering until every tree
 * conforms, and the gate goes green having proved nothing — which matters more
 * than usual here, because this comparison is the LAST line of defence for the
 * plan's highest-rated risk (R3, wrong-range destructive edits) now that the
 * structure index has moved to the design doc. A vacuous gate does not merely
 * fail to help; it manufactures confidence.
 *
 * So both halves are enumerated IN CODE, not prose: `SEMANTIC_KEYS` says what
 * survives per node type, `NEVER_SEMANTIC` what never does. Node `type` and
 * child ORDER always survive. A listed type that silently drops a field the
 * parser emits fails `semanticProjection.test.ts` — `math.meta` did exactly
 * that until the check found it.
 *
 * @coordinates-with parserConformance.test.ts — the gate
 * @coordinates-with positionTrust.ts — which nodes may carry offsets at all
 * @module utils/markdownPipeline/conformance/semanticProjection
 */

/** Minimal mdast-compatible shape. */
export interface RawNode {
  type: string;
  children?: RawNode[];
  value?: unknown;
  [key: string]: unknown;
}

/** The compared form of one node. */
export interface ProjectedNode {
  type: string;
  /** Only the semantic keys, sorted for stable comparison of the OBJECT. */
  attributes: Record<string, unknown>;
  /** Never reordered — child order is semantic. */
  children: ProjectedNode[];
}

/**
 * Keys that carry meaning, per node type.
 *
 * An explicit allow-list, not a deny-list: a new mdast field is invisible to
 * the gate until someone decides it is semantic, which is the safe direction.
 * A deny-list would silently start comparing plumbing.
 */
const SEMANTIC_KEYS: Record<string, readonly string[]> = {
  text: ["value"],
  inlineCode: ["value"],
  code: ["value", "lang", "meta"],
  math: ["value", "meta"],
  inlineMath: ["value", "meta"],
  yaml: ["value"],
  html: ["value"],
  heading: ["depth"],
  list: ["ordered", "start", "spread"],
  listItem: ["checked", "spread"],
  link: ["url", "title"],
  linkReference: ["identifier", "label", "referenceType"],
  image: ["url", "title", "alt"],
  imageReference: ["identifier", "label", "alt", "referenceType"],
  definition: ["identifier", "label", "url", "title"],
  footnoteDefinition: ["identifier", "label"],
  footnoteReference: ["identifier", "label"],
  table: ["align"],
  // VMark extensions.
  wikiLink: ["target", "alias", "value"],
  details: ["summary", "open"],
  toc: ["value"],
  highlight: [],
  subscript: [],
  superscript: [],
  underline: [],
};

/**
 * Fields that are never semantic, whatever the node type.
 *
 * `data` is mdast-util plumbing and renderer hints; `position` is compared
 * separately, per domain, and only where `positionTrust` allows.
 */
export const NEVER_SEMANTIC: ReadonlySet<string> = new Set([
  "type",
  "children",
  "position",
  "data",
]);

/**
 * Fields a LISTED type deliberately drops.
 *
 * Empty, and the gate keeps it that way: `semanticProjection.test.ts` fails if
 * the parser emits a field on a listed type that the allow-list omits. `math`'s
 * `meta` — the text after the opening `$$` — was dropped exactly that way until
 * the check found it, which would have made two documents differing only in a
 * math label compare equal.
 */
export const DELIBERATELY_DROPPED: ReadonlyMap<string, ReadonlySet<string>> = new Map();

/** Types whose semantic keys are enumerated above. */
export function listedTypes(): string[] {
  return Object.keys(SEMANTIC_KEYS);
}

/** The semantic attributes of one node, with undefined values omitted. */
function attributesOf(node: RawNode): Record<string, unknown> {
  // `Object.hasOwn`, not a bare index: a node typed "constructor" or
  // "__proto__" would otherwise resolve to a prototype member and throw when
  // spread. mdast types are parser-controlled today, but this list is the
  // gate's foundation and must not depend on that staying true.
  const allowed = Object.hasOwn(SEMANTIC_KEYS, node.type)
    ? SEMANTIC_KEYS[node.type]
    : undefined;
  const keys =
    allowed ??
    // An UNKNOWN node type keeps every non-plumbing field. A new extension
    // must be noticed by the gate, not silently compared as bare `{}`.
    Object.keys(node).filter((k) => !NEVER_SEMANTIC.has(k));

  const out: Record<string, unknown> = {};
  for (const key of [...keys].sort()) {
    const value = node[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Project a tree into its compared form. */
export function project(node: RawNode): ProjectedNode {
  return {
    type: node.type,
    attributes: attributesOf(node),
    children: (node.children ?? []).map(project),
  };
}

/**
 * Order-independent structural equality for attribute values.
 *
 * `JSON.stringify` compares key INSERTION ORDER, so two equivalent objects
 * differing only in construction order read as divergent — a false positive in
 * a gate whose credibility depends on its findings being real. It also throws
 * on a cycle. Keys are sorted recursively here and cycles are reported as
 * unequal rather than crashing the comparison.
 */
export function sameValue(a: unknown, b: unknown, seen = new Set<unknown>()): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (seen.has(a) || seen.has(b)) return false; // cyclic: not provably equal
  seen.add(a);
  seen.add(b);

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    // Index loop, not `every`: `every` SKIPS holes, so [ , 1] and [0, 1]
    // compared equal.
    for (let i = 0; i < a.length; i += 1) {
      if (!sameValue(a[i], b[i], seen)) return false;
    }
    return true;
  }

  // Built-ins carry their value OUTSIDE enumerable keys, so a key-by-key walk
  // finds nothing to compare and calls two different Dates — or RegExps, Maps,
  // Sets — equal. mdast attributes are plain data today; this refuses to
  // silently bless the day one is not.
  const tag = (v: object) => Object.prototype.toString.call(v);
  if (tag(a) !== tag(b)) return false;
  if (tag(a) !== "[object Object]") {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (a instanceof RegExp && b instanceof RegExp) return String(a) === String(b);
    // Any other exotic type: not provably equal, so report a difference rather
    // than assert one that has not been checked.
    return false;
  }

  const aKeys = Object.keys(a as object).sort();
  const bKeys = Object.keys(b as object).sort();
  if (aKeys.length !== bKeys.length) return false;
  if (aKeys.some((k, i) => k !== bKeys[i])) return false;
  return aKeys.every((k) =>
    sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], seen)
  );
}

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
    // to avoid. Attributes are skipped (unrelated shapes have unrelated
    // fields), but children are still compared by index.
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
      ...diff(documentTree.children[i], sourceTree.children[i], `${path}.children[${i}]`)
    );
  }
  return out;
}
