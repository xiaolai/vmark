/**
 * The rebase arithmetic, tested directly.
 *
 * `detailsOffsets.test.ts` covers this end to end through the parser, which is
 * where the bug was found — but end-to-end tests exercise one shape at a time
 * and the arithmetic has edge cases (a body starting mid-line, a body past a
 * newline, an empty body, a node with no position) that are far cheaper to pin
 * here than to construct markdown for.
 *
 * @coordinates-with utils/markdownPipeline/plugins/rebasePositions.ts
 * @module utils/markdownPipeline/plugins/rebasePositions.test
 */
import { describe, it, expect } from "vitest";
import { originWithin, rebasePositions, type RebaseOrigin } from "./rebasePositions";

/** A host node beginning at offset 10, line 3, column 1. */
const HOST: RebaseOrigin = { offset: 10, line: 3, column: 1 };

const node = (start: number, end: number, line = 1, column = 1) => ({
  position: {
    start: { offset: start, line, column },
    end: { offset: end, line, column: column + (end - start) },
  },
});

describe("originWithin", () => {
  it("stays on the host's line when the body starts before any newline", () => {
    // The COMPACT form: `<details><summary>S</summary>body</details>` is one
    // line, so the body continues the host's line and column.
    expect(originWithin("<details><summary>S</summary>body", 29, HOST)).toEqual({
      offset: 39,
      line: 3,
      column: 30,
    });
  });

  it("advances the line for each newline before the body", () => {
    expect(originWithin("<details>\n<summary>S</summary>\nbody", 31, HOST)).toEqual({
      offset: 41,
      line: 5,
      column: 1,
    });
  });

  it("measures the column from the LAST newline, not the host's column", () => {
    // Past a break, the host's column is irrelevant — the body's column is its
    // distance into that line.
    // "ab\ncdef", bodyStart 5 → index 5 is `e`, the THIRD character of the
    // line "cdef" (1-based), so column 3. The host's column 40 is irrelevant
    // once a newline has been crossed.
    const origin = originWithin("ab\ncdef", 5, { offset: 100, line: 7, column: 40 });
    expect(origin).toEqual({ offset: 105, line: 8, column: 3 });
  });

  it("handles a body at offset 0 of the host value", () => {
    expect(originWithin("body", 0, HOST)).toEqual({ offset: 10, line: 3, column: 1 });
  });

  it.each([
    { label: "past the end", bodyStart: 999 },
    { label: "negative", bodyStart: -1 },
    { label: "non-integer", bodyStart: 1.5 },
  ])("REJECTS a bodyStart that is $label", ({ bodyStart }) => {
    // Not "does not throw" — that was the earlier assertion, and it blessed
    // fabricated coordinates: 999 past a 5-character host returned an offset
    // 999 forward and a column to match, describing a place the document does
    // not have.
    expect(() => originWithin("short", bodyStart, HOST)).toThrow(RangeError);
  });

  it("accepts a bodyStart exactly AT the end — an empty body is legitimate", () => {
    expect(originWithin("short", 5, HOST)).toEqual({ offset: 15, line: 3, column: 6 });
  });
});

describe("rebasePositions", () => {
  it("shifts offsets by the origin", () => {
    const nodes = [node(0, 5)];
    rebasePositions(nodes, HOST);
    expect(nodes[0].position.start.offset).toBe(10);
    expect(nodes[0].position.end.offset).toBe(15);
  });

  it("shifts line 1 onto the host line and offsets its column", () => {
    const nodes = [node(0, 5, 1, 1)];
    rebasePositions(nodes, { offset: 10, line: 3, column: 30 });
    expect(nodes[0].position.start.line).toBe(3);
    expect(nodes[0].position.start.column).toBe(30);
  });

  it("leaves LATER lines' columns alone — only line 1 continues the host", () => {
    // A body's second line starts at column 1 of its own line, not at the
    // host's column. Adding the offset to every line was the tempting error.
    const nodes = [node(0, 5, 2, 1)];
    rebasePositions(nodes, { offset: 10, line: 3, column: 30 });
    expect(nodes[0].position.start.line).toBe(4);
    expect(nodes[0].position.start.column).toBe(1);
  });

  it("recurses into children", () => {
    const child = node(2, 4);
    const nodes = [{ ...node(0, 10), children: [child] }];
    rebasePositions(nodes, HOST);
    expect(child.position.start.offset).toBe(12);
  });

  it("recurses to arbitrary depth", () => {
    const deep = node(1, 2);
    const nodes = [
      { ...node(0, 10), children: [{ ...node(0, 8), children: [deep] }] },
    ];
    rebasePositions(nodes, HOST);
    expect(deep.position.start.offset).toBe(11);
  });

  it("leaves a node with no position untouched, and keeps going", () => {
    // The positionless node must not stop the walk reaching its children.
    const child = node(1, 2);
    const sibling = node(5, 6);
    const nodes = [{ children: [child] }, sibling];

    expect(() => rebasePositions(nodes as never, HOST)).not.toThrow();
    expect(child.position.start.offset).toBe(11);
    expect(sibling.position.start.offset).toBe(15);
  });

  it("shifts each node exactly once", () => {
    // A node reachable by two paths would be shifted twice — the tree is a
    // tree, but asserting it keeps a future `visit`-based rewrite honest.
    const only = node(1, 2);
    rebasePositions([only], HOST);
    expect(only.position.start.offset).toBe(11);
  });

  it("is a no-op for an empty list", () => {
    expect(() => rebasePositions([], HOST)).not.toThrow();
  });

  it("tolerates a partial position — shifts what is there", () => {
    const partial = { position: { start: { offset: 3 } } };
    rebasePositions([partial], HOST);
    expect(partial.position.start.offset).toBe(13);
  });
});
