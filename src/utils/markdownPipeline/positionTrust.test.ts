// @vitest-environment node
/**
 * WI-3.1 — position propagation, checked against the PARSER.
 *
 * A hand-maintained list of "nodes without positions" rots the moment a plugin
 * changes. This parses a document that exercises every extension and compares
 * what actually comes out against the registry, so the two cannot drift: a node
 * type that gains positions must be removed from the untrusted set, and one
 * that loses them must be added.
 *
 * The risk being guarded is the highest-rated one in the plan (R3, wrong-range
 * destructive edits). `<details>` is the sharp case — its body is re-parsed
 * from an extracted substring, so descendants carry offsets that are perfectly
 * well-formed and address the wrong text. That is invisible to a per-node
 * `position` check, which is why trust is inherited here.
 *
 * @coordinates-with utils/markdownPipeline/positionTrust.ts
 * @module utils/markdownPipeline/positionTrust.test
 */
import { describe, it, expect } from "vitest";
import { visit } from "unist-util-visit";
import "./dialect";
import { createMarkdownProcessor } from "./parser/processorFactory";
import {
  UNTRUSTED_POSITION_TYPES,
  REBASED_SUBTREE_TYPES,
  canonicalRangeOf,
  collectUntrusted,
  isUntrustedType,
  requireCanonicalRange,
  type PositionedNode,
} from "./positionTrust";

/** A document exercising every extension that can synthesise a node. */
const KITCHEN_SINK = [
  "# Heading",
  "",
  "Plain paragraph with **strong** and `code`.",
  "",
  "A [[wiki link]], ==highlight==, ~sub~, ^sup^, ++underline++.",
  "",
  "- list item",
  "",
  "> quote",
  "",
  "```js",
  "const x = 1;",
  "```",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "<details><summary>Summary</summary>",
  "",
  "Body **bold** and a [link](http://x).",
  "",
  "</details>",
  "",
  "[toc]",
].join("\n");

function parseKitchenSink(): PositionedNode {
  const processor = createMarkdownProcessor();
  return processor.runSync(processor.parse(KITCHEN_SINK)) as unknown as PositionedNode;
}

/** Node types the parser emits WITHOUT a position, ignoring inheritance. */
function typesLackingOwnPosition(tree: PositionedNode): Set<string> {
  const out = new Set<string>();
  visit(tree as never, (node: PositionedNode) => {
    if (!node.position) out.add(node.type);
  });
  return out;
}

describe("the registry matches what the parser actually emits", () => {
  it("every registered type really does lack a position", () => {
    // A stale entry is not harmless: it makes a node permanently unable to
    // authorise an edit that it could safely authorise.
    const lacking = typesLackingOwnPosition(parseKitchenSink());
    const notActuallyMissing = [...UNTRUSTED_POSITION_TYPES].filter(
      (t) => !lacking.has(t)
    );
    expect(notActuallyMissing).toEqual([]);
  });

  it("no EXTENSION type lacks a position without being registered", () => {
    // `text` legitimately appears in `lacking` — but only as a DESCENDANT of a
    // registered construct, which inheritance already covers. A new extension
    // node type showing up here is the drift this test exists to catch.
    const lacking = typesLackingOwnPosition(parseKitchenSink());
    const unregistered = [...lacking].filter(
      (t) => !UNTRUSTED_POSITION_TYPES.has(t) && t !== "text"
    );
    expect(unregistered).toEqual([]);
  });

  it("the constructs that DO carry positions still do", () => {
    // Guards the opposite drift: a plugin that starts dropping positions on
    // ordinary blocks would otherwise silently disable range-authorised edits.
    const tree = parseKitchenSink();
    const withPosition = new Set<string>();
    visit(tree as never, (node: PositionedNode) => {
      if (node.position) withPosition.add(node.type);
    });
    for (const type of ["heading", "paragraph", "list", "blockquote", "code", "table", "toc"]) {
      expect(withPosition.has(type)).toBe(true);
    }
  });
});

describe("canonicalRangeOf refuses rather than guesses", () => {
  it("returns a range for an ordinary positioned node", () => {
    expect(
      canonicalRangeOf({
        type: "paragraph",
        position: { start: { offset: 3 }, end: { offset: 9 } },
      })
    ).toEqual({ start: 3, end: 9 });
  });

  it.each([
    { label: "an untrusted TYPE, even with a position", node: { type: "details", position: { start: { offset: 0 }, end: { offset: 5 } } } },
    { label: "no position at all", node: { type: "paragraph" } },
    { label: "a missing start offset", node: { type: "paragraph", position: { end: { offset: 5 } } } },
    { label: "a missing end offset", node: { type: "paragraph", position: { start: { offset: 5 } } } },
    { label: "a reversed range", node: { type: "paragraph", position: { start: { offset: 9 }, end: { offset: 3 } } } },
    { label: "a negative offset", node: { type: "paragraph", position: { start: { offset: -1 }, end: { offset: 3 } } } },
    { label: "a non-integer offset", node: { type: "paragraph", position: { start: { offset: 1.5 }, end: { offset: 3 } } } },
  ])("returns null for $label", ({ node }) => {
    expect(canonicalRangeOf(node as PositionedNode)).toBeNull();
  });

  it("accepts a zero-width range at offset 0 — empty is not absent", () => {
    expect(
      canonicalRangeOf({
        type: "paragraph",
        position: { start: { offset: 0 }, end: { offset: 0 } },
      })
    ).toEqual({ start: 0, end: 0 });
  });
});

describe("inheritance applies only where measured", () => {
  it("no longer distrusts a details descendant — the offsets are rebased", () => {
    // Took three measurements: unmeasured claim, then multiline-only, then the
    // form-dependent truth. The right response to the third was to fix the
    // offsets (parseDetailsBody rebases into host coordinates), not to refuse
    // them — refusing cost every diagnostic inside a details body.
    const child: PositionedNode = {
      type: "paragraph",
      position: { start: { offset: 10 }, end: { offset: 14 } },
    };
    const tree: PositionedNode = {
      type: "root",
      position: { start: { offset: 0 }, end: { offset: 50 } },
      children: [{ type: "details", children: [child] }],
    };

    const untrusted = collectUntrusted(tree);
    expect(untrusted.has(child)).toBe(false);
    expect(untrusted.size).toBe(1); // the positionless details node itself
  });

  it("still distrusts a descendant that lacks its OWN canonical range", () => {
    const child: PositionedNode = { type: "text" };
    const tree: PositionedNode = {
      type: "root",
      position: { start: { offset: 0 }, end: { offset: 50 } },
      children: [{ type: "details", children: [child] }],
    };

    expect(collectUntrusted(tree).has(child)).toBe(true);
  });

  it("does NOT distrust a non-rebasing container's positioned children", () => {
    // Inheritance is narrow: only the listed types re-base. A blockquote's
    // children keep their own canonical ranges.
    const child: PositionedNode = {
      type: "paragraph",
      position: { start: { offset: 2 }, end: { offset: 8 } },
    };
    const tree: PositionedNode = {
      type: "root",
      position: { start: { offset: 0 }, end: { offset: 50 } },
      children: [
        {
          type: "blockquote",
          position: { start: { offset: 0 }, end: { offset: 20 } },
          children: [child],
        },
      ],
    };

    expect(REBASED_SUBTREE_TYPES.size).toBe(0);
    expect(collectUntrusted(tree).has(child)).toBe(false);
  });

  it("distrusts a node whose position object is MALFORMED, not merely absent", () => {
    // `!node.position` missed `{ position: {} }` and reversed ranges, which
    // canonicalRangeOf rejected — the two disagreed about the same node.
    for (const bad of [
      { type: "paragraph", position: {} },
      { type: "paragraph", position: { start: { offset: 9 }, end: { offset: 3 } } },
      { type: "paragraph", position: { start: { offset: 1.5 }, end: { offset: 3 } } },
    ] as PositionedNode[]) {
      const tree: PositionedNode = {
        type: "root",
        position: { start: { offset: 0 }, end: { offset: 50 } },
        children: [bad],
      };
      expect(collectUntrusted(tree).has(bad)).toBe(true);
    }
  });

  it("leaves a fully positioned tree entirely trusted", () => {
    const child: PositionedNode = {
      type: "text",
      position: { start: { offset: 2 }, end: { offset: 6 } },
    };
    const tree: PositionedNode = {
      type: "root",
      position: { start: { offset: 0 }, end: { offset: 10 } },
      children: [
        {
          type: "paragraph",
          position: { start: { offset: 0 }, end: { offset: 10 } },
          children: [child],
        },
      ],
    };

    expect(collectUntrusted(tree).size).toBe(0);
  });
});

describe("requireCanonicalRange throws instead of editing the wrong text", () => {
  it("returns the range when the node has one", () => {
    expect(
      requireCanonicalRange(
        { type: "paragraph", position: { start: { offset: 1 }, end: { offset: 4 } } },
        "replaceBlock"
      )
    ).toEqual({ start: 1, end: 4 });
  });

  it("names the action and the node type", () => {
    expect(() => requireCanonicalRange({ type: "wikiLink" }, "deleteRange")).toThrow(
      /deleteRange.*wikiLink/
    );
  });

  it("explains that a synthesised node's offsets address another string", () => {
    expect(() => requireCanonicalRange({ type: "details" }, "x")).toThrow(
      /different string/
    );
  });

  it("distinguishes an unpositioned ordinary node from a synthesised one", () => {
    expect(() => requireCanonicalRange({ type: "paragraph" }, "x")).toThrow(
      /no position/
    );
  });
});

describe("isUntrustedType", () => {
  it.each([...UNTRUSTED_POSITION_TYPES])("rejects %s", (type) => {
    expect(isUntrustedType(type)).toBe(true);
  });

  it.each(["paragraph", "heading", "text", "code", "table", "toc"])(
    "accepts %s",
    (type) => {
      expect(isUntrustedType(type)).toBe(false);
    }
  );
});
