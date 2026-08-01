/**
 * Purpose: say which mdast nodes carry a CANONICAL source range, and stop the
 * ones that do not from authorising a destructive edit.
 *
 * `position` on an mdast node is optional, and several of VMark's extensions
 * synthesise nodes without one. A consumer that maps a node back to source
 * offsets in order to replace, delete or wrap text has no way to tell a
 * trustworthy range from an absent one — `node.position?.start.offset ?? 0`
 * silently means "the start of the document".
 *
 * Measured against the real `source-position` parser rather than assumed:
 *
 *   | node        | position | why                                            |
 *   |-------------|----------|------------------------------------------------|
 *   | wikiLink    | absent   | synthesised by remarkWikiLinks from a text scan |
 *   | highlight   | absent   | remarkCustomInline, same                       |
 *   | subscript   | absent   | remarkCustomInline, same                       |
 *   | superscript | absent   | remarkCustomInline, same                       |
 *   | underline   | absent   | remarkCustomInline, same                       |
 *   | details     | absent   | rebuilt from html nodes; body is REPARSED       |
 *
 * The `details` case is the sharpest and the one an enumeration of extension
 * nodes alone would miss: its body is re-parsed from an extracted substring,
 * so every node INSIDE it carries positions local to that substring. They look
 * perfectly valid — small integers, ordered, non-overlapping — and they address
 * the wrong text. An audit of a document with one details block found 6 of 9
 * text nodes with no position at all, all of them inside these constructs.
 *
 * Key decisions:
 *   - UNTRUSTED IS INHERITED. A node whose ancestor is untrusted is untrusted,
 *     even when it has a `position` of its own, because that position belongs
 *     to a different string. Checking the node alone is the trap.
 *   - The registry is checked against the PARSER, not maintained by hand:
 *     `positionTrust.test.ts` parses a document exercising every extension and
 *     fails if a node type gains or loses positions without this list moving.
 *   - The domain is `canonicalEditorText` (LF, BOM-free) — decision D3 reserves
 *     `rawDiskText` for ingestion, and the two readings of "raw" are exactly the
 *     ambiguity that makes an offset a wrong-range risk.
 *
 * @coordinates-with dialectDescriptors.ts — the plugins that emit these nodes
 * @coordinates-with positionTrust.test.ts — the empirical drift gate
 * @module utils/markdownPipeline/positionTrust
 */

/**
 * Node types that never carry a canonical source range.
 *
 * Each is synthesised after parsing — from a text scan or a re-parse — so any
 * `position` it or its descendants carry addresses a string other than the
 * document.
 */
export const UNTRUSTED_POSITION_TYPES: ReadonlySet<string> = new Set([
  "wikiLink",
  "highlight",
  "subscript",
  "superscript",
  "underline",
  "details",
]);

/**
 * Containers that STRIP a line prefix from their descendants' text values.
 *
 * A separate hazard from an absent position, and subtler. Inside `> quoted\n>
 * more`, the text node's range correctly spans `quoted\n> more` while its
 * `value` is `quoted\nmore` — remark removes the continuation markers. The
 * range is canonical: it addresses the right span, and an edit at those offsets
 * hits the right text. But `source.slice(start, end) !== node.value`, so code
 * that reconstructs content FROM a range gets the markers back.
 *
 * Measured, not assumed — the conformance gate found it on `> quoted\n> more`.
 * Consumers that replace a range are fine; consumers that compare a slice to a
 * value must account for it.
 */
export const PREFIX_STRIPPING_CONTAINERS: ReadonlySet<string> = new Set([
  "blockquote",
  "listItem",
]);

/** Minimal node shape — mdast-compatible without importing the union. */
export interface PositionedNode {
  type: string;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  children?: PositionedNode[];
}

/** A half-open UTF-16 range over `canonicalEditorText`. */
export interface SourceRange {
  start: number;
  end: number;
}

/** Whether this node TYPE is one that never carries a canonical range. */
export function isUntrustedType(type: string): boolean {
  return UNTRUSTED_POSITION_TYPES.has(type);
}

/**
 * The canonical range of `node`, or null when it has none to give.
 *
 * Returns null — never a fallback — for an untrusted type, a missing
 * `position`, a missing offset, or a reversed/degenerate range. A caller that
 * wants to guess can guess explicitly; the common bug is a `?? 0` that silently
 * addresses the start of the document.
 */
export function canonicalRangeOf(node: PositionedNode): SourceRange | null {
  if (isUntrustedType(node.type)) return null;
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return null;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end < start) return null;
  return { start, end };
}

/**
 * Every node in `tree` whose range must not be trusted, by type.
 *
 * UNTRUSTED IS INHERITED: descendants of an untrusted node are included even
 * when they carry a `position`, because a re-parsed `<details>` body numbers
 * its children from the extracted substring. Those offsets are well-formed and
 * wrong — the failure mode a per-node check cannot see.
 */
export function collectUntrusted(tree: PositionedNode): Set<PositionedNode> {
  const out = new Set<PositionedNode>();

  const walk = (node: PositionedNode, inherited: boolean): void => {
    const untrusted = inherited || isUntrustedType(node.type) || !node.position;
    if (untrusted) out.add(node);
    for (const child of node.children ?? []) {
      walk(child, inherited || isUntrustedType(node.type));
    }
  };

  walk(tree, false);
  return out;
}

/**
 * Assert `node` may authorise a destructive edit, returning its range.
 *
 * Throws rather than returning null: a caller reaching here has already decided
 * to replace or delete text, and the failure it is guarding against is doing so
 * at the wrong offsets. A thrown error loses one operation; a wrong range loses
 * the user's content.
 */
export function requireCanonicalRange(node: PositionedNode, action: string): SourceRange {
  const range = canonicalRangeOf(node);
  if (!range) {
    throw new Error(
      `${action}: "${node.type}" carries no canonical source range, so it cannot ` +
        `authorise a source edit. ` +
        (isUntrustedType(node.type)
          ? "This node type is synthesised after parsing — its offsets, if any, " +
            "address a different string (see positionTrust.ts)."
          : "The node has no position; it may have been synthesised or copied."),
    );
  }
  return range;
}
