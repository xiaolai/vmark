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
 *   | details     | absent   | rebuilt from html nodes                        |
 *
 * CORRECTED 2026-08-01. An earlier version of this file claimed the `<details>`
 * BODY carried positions local to the extracted substring — inherited from a
 * plan review and repeated here as though measured. It is FALSE. Measured
 * node by node against the real parser, every descendant of a details block
 * carries a CORRECT absolute offset: `slice(start, end)` returns the node's own
 * text for a document where the block sits at offset 75 and at offset 134. The
 * `details` node itself has no position; its children are fine.
 *
 * The mistake mattered: acting on it made this module refuse ranges that were
 * perfectly good, which cost the link checker its diagnostics inside details
 * bodies for no safety gain.
 *
 * Key decisions:
 *   - A SEPARATE HAZARD: a range can be canonical while the node's `value` is
 *     not its slice. Blockquotes and list items strip continuation markers from
 *     descendants' text, so `slice(range) !== value` there. Edits at those
 *     offsets are correct; reconstruction from them is not. See
 *     PREFIX_STRIPPING_CONTAINERS — found by the conformance gate, not assumed.
 *     `footnoteDefinition` belongs there too, and was missing until a fixture
 *     exercised it: the set is only as measured as the corpus behind it.
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
  // MEASURED, like the other two, not reasoned by analogy: a continuation line
  // in `[^a]: first\n    second` has its four-space indent removed, so the text
  // node's value is `first\nsecond` while its slice keeps the indent. It was
  // missing because no fixture exercised it — "measured, not assumed" is only
  // as strong as the corpus, which is why `conf-footnote-continuation` exists.
  "footnoteDefinition",
]);

/**
 * Types whose DESCENDANTS carry offsets into some other string.
 *
 * EMPTY — because the cause was fixed rather than guarded. `details` was the
 * one entry, and the measurement took three attempts to get right:
 *
 *   attempt 1: "the body is offset-local"      — from a plan review, unmeasured
 *   attempt 2: "the body is absolute"          — measured on MULTILINE only
 *   attempt 3: "it depends on the form"        — COMPACT re-parses a substring
 *
 * The third was true, and guarding on it cost every diagnostic inside a
 * details body. `parseDetailsBody` now rebases the re-parsed subtree into host
 * coordinates from the html node's own position and value — offsets AND
 * line/column, verified across compact, multiline, deep and multiline-value
 * forms — so no details descendant is re-based any more and the entry is gone.
 *
 * The mechanism stays for the next construct that re-parses without rebasing.
 * Adding a type is a claim backed by measurement of EVERY form the construct
 * takes — measuring one form and generalising produced two wrong claims here,
 * and the right response to the third was to fix the offsets, not distrust
 * them.
 */
export const REBASED_SUBTREE_TYPES: ReadonlySet<string> = new Set<string>();

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
 * `position`, a missing or non-integer offset, or a REVERSED range. A caller
 * that wants to guess can guess explicitly; the common bug is a `?? 0` that
 * silently addresses the start of the document.
 *
 * A ZERO-WIDTH range (`start === end`) is valid, not degenerate: an empty node
 * legitimately occupies no characters, and an insertion point is a real
 * position. Only `end < start` is rejected.
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
 * Every node in `tree` whose range must not be trusted.
 *
 * A node is untrusted when `canonicalRangeOf` refuses it — the same predicate,
 * so the two can never disagree about one node. Distrust is INHERITED only
 * from `REBASED_SUBTREE_TYPES`, which is empty and measured to be: a node whose
 * own offsets are absent says nothing about its children's, and treating it as
 * if it did refused ranges that were correct.
 */
export function collectUntrusted(tree: PositionedNode): Set<PositionedNode> {
  const out = new Set<PositionedNode>();

  const walk = (node: PositionedNode, inherited: boolean): void => {
    // The SAME predicate `canonicalRangeOf` applies. Testing `!node.position`
    // instead let a node with `{ position: {} }`, a missing offset, a reversed
    // range or a non-integer offset out of the set — while `canonicalRangeOf`
    // rejected it — so the two disagreed about the same node and its
    // descendants inherited nothing.
    //
    // Distrust propagates. An earlier version passed down only the registered
    // TYPES, which failed unsafely: a synthesised node this module has not
    // heard of marked itself and then blessed its children, whose offsets are
    // just as likely to be re-based. A false positive blocks one edit; a false
    // negative edits the wrong text.
    const untrusted = inherited || canonicalRangeOf(node) === null;
    if (untrusted) out.add(node);
    // Inheritance is NOT `untrusted` — see REBASED_SUBTREE_TYPES. A node
    // lacking its own position does not make its children's offsets wrong,
    // and assuming otherwise cost real functionality.
    const rebasesChildren = inherited || REBASED_SUBTREE_TYPES.has(node.type);
    for (const child of node.children ?? []) {
      walk(child, rebasesChildren);
    }
  };

  walk(tree, false);
  return out;
}

/**
 * A range authorizer bound to ONE tree.
 *
 * `requireCanonicalRange` alone inspects a single node, so a positioned
 * descendant of an untrusted `<details>` subtree passes it — the node looks
 * fine, and its offsets address the re-parsed substring. Ancestry is not
 * visible from a node, so the only sound check is one that walked the tree.
 * This is the API range-authorising consumers should use; the bare function
 * remains for a node whose provenance the caller already knows.
 */
export interface RangeAuthorizer {
  /** The node's range, or null if it or any ancestor is untrusted. */
  rangeOf(node: PositionedNode): SourceRange | null;
  /** As `rangeOf`, but throws with `action` named. */
  require(node: PositionedNode, action: string): SourceRange;
}

/** Build an authorizer that knows `tree`'s inherited trust. */
export function createRangeAuthorizer(tree: PositionedNode): RangeAuthorizer {
  const untrusted = collectUntrusted(tree);
  return {
    rangeOf: (node) => (untrusted.has(node) ? null : canonicalRangeOf(node)),
    require(node, action) {
      if (untrusted.has(node)) {
        throw new Error(
          `${action}: "${node.type}" is inside a synthesised or re-parsed ` +
            `subtree, so its offsets address a different string than the ` +
            `document (see positionTrust.ts).`,
        );
      }
      return requireCanonicalRange(node, action);
    },
  };
}

/**
 * Assert `node` may authorise a destructive edit, returning its range.
 *
 * Checks the NODE ONLY. Prefer `createRangeAuthorizer(tree).require(...)` when
 * the node came from a tree — ancestry is invisible here.
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
