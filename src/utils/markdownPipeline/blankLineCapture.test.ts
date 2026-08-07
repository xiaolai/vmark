// @vitest-environment node
// Gap-capture edge cases for blank-line preservation (WI-1.2 / ADR-4).
// convertTopLevelWithBlankLines reads MDAST positions to size the gap before a
// block; these pin the two ways a bad/absent position must degrade to "no gap"
// rather than corrupt the output.
import { describe, it, expect } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import type { Content, Root } from "mdast";
import { convertTopLevelWithBlankLines } from "./blankLineCapture";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      attrs: { blankLinesBefore: { default: null } },
      content: "inline*",
      group: "block",
    },
    text: { group: "inline" },
  },
});

/** Each mdast child → one paragraph; the converter reads child.position only. */
function toPara(child: Content): PMNode {
  const value = (child as { value?: string }).value ?? "x";
  return schema.node("paragraph", null, [schema.text(value)]);
}

function para(value: string, startLine: number, endLine: number): Content {
  return {
    type: "paragraph",
    value,
    position: {
      start: { line: startLine, column: 1, offset: 0 },
      end: { line: endLine, column: 1, offset: 0 },
    },
  } as unknown as Content;
}

function blanksOf(nodes: PMNode[]): Array<number | null> {
  return nodes.map((n) => n.attrs.blankLinesBefore);
}

describe("convertTopLevelWithBlankLines — malformed/absent positions", () => {
  it("resets the gap across a positionless intervening node (no spurious run)", () => {
    // A (line 1), a synthetic positionless node, B (line 8). Keeping A's end as
    // prevEndLine makes B capture 8-1-1 = 6 blank lines that span the whole
    // intervening node — a large spurious gap. A reset must yield null instead.
    const root: Root = {
      type: "root",
      children: [
        para("A", 1, 1),
        { type: "html", value: "<details></details>" } as unknown as Content, // no position
        para("B", 8, 8),
      ],
    };
    expect(blanksOf(convertTopLevelWithBlankLines(root, toPara))).toEqual([null, null, null]);
  });

  it("ignores non-integer (NaN) line positions instead of writing a NaN attr", () => {
    // A's end line is NaN; without validation B captures 8-NaN-1 = NaN, which
    // as a join count removes the separator between blocks.
    const root: Root = {
      type: "root",
      children: [para("A", 1, NaN as unknown as number), para("B", 8, 8)],
    };
    expect(blanksOf(convertTopLevelWithBlankLines(root, toPara))).toEqual([null, null]);
  });

  it("still captures a normal >1 run between well-positioned blocks", () => {
    const root: Root = {
      type: "root",
      children: [para("A", 1, 1), para("B", 5, 5)], // 3 blank lines (2,3,4)
    };
    expect(blanksOf(convertTopLevelWithBlankLines(root, toPara))).toEqual([null, 3]);
  });
});
