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
 * So what survives and what is dropped are both enumerated.
 *
 * SURVIVES — a difference here is a real divergence:
 *   - node `type`
 *   - children, IN ORDER (never sorted, never flattened)
 *   - semantic VALUES: text/code/math content, heading depth, list ordered and
 *     start, listItem checked, link and image url/title/alt, code lang and
 *     meta, table alignment, wikiLink target
 *   - extension ATTRIBUTES: the details summary, alert kind, toc marker
 *
 * DROPPED — these are not dialect, and comparing them measures the harness:
 *   - `position` (compared separately, per domain, and only where trusted)
 *   - `data` (renderer hints and mdast-util plumbing)
 *   - the raw `value` of an mdast `html` node when it is the delimiter of a
 *     construct one mode parses and the other does not; the CONSTRUCT is
 *     compared instead
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
  math: ["value"],
  inlineMath: ["value"],
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

/** Fields that are never semantic, whatever the node type. */
const NEVER_SEMANTIC = new Set(["type", "children", "position", "data"]);

/** The semantic attributes of one node, with undefined values omitted. */
function attributesOf(node: RawNode): Record<string, unknown> {
  const allowed = SEMANTIC_KEYS[node.type];
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
    // Types differ: comparing their attributes and children compares unrelated
    // shapes and buries the one difference that matters under noise.
    return out;
  }

  const keys = new Set([
    ...Object.keys(documentTree.attributes),
    ...Object.keys(sourceTree.attributes),
  ]);
  for (const key of [...keys].sort()) {
    const a = documentTree.attributes[key];
    const b = sourceTree.attributes[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
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

  const shared = Math.min(documentTree.children.length, sourceTree.children.length);
  for (let i = 0; i < shared; i += 1) {
    out.push(
      ...diff(documentTree.children[i], sourceTree.children[i], `${path}.children[${i}]`)
    );
  }

  return out;
}
