import { describe, it, expect } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";
import { testSchema } from "@/utils/markdownPipeline/testSchema";
import { buildTextPositionMap, parentOffsetToTextOffset } from "./wysiwygTextPositionMap";

const s = testSchema;
const p = (...content: PMNode[]) => s.node("paragraph", null, content);
const text = (t: string) => s.text(t);
const br = () => s.node("hardBreak");
const math = () => s.node("math_inline", { content: "x" });

// p("ab", br, "cd", math, "e") — parent offsets: "ab" 0..2, br 2..3,
// "cd" 3..5, math 5..6, "e" 6..7. With blockStart 1 the doc positions of
// the five characters are 1, 2, 4, 5, 7.
const mixed = p(text("ab"), br(), text("cd"), math(), text("e"));

describe("buildTextPositionMap", () => {
  it("skips inline atoms while keeping each character's doc position", () => {
    const map = buildTextPositionMap(mixed, 1);
    expect(map.text).toBe("abcde");
    expect(map.positions).toEqual([1, 2, 4, 5, 7]);
  });

  it("maps a plain text-only block one-to-one", () => {
    const map = buildTextPositionMap(p(text("hey")), 5);
    expect(map.text).toBe("hey");
    expect(map.positions).toEqual([5, 6, 7]);
  });

  it("returns empty text for a block with no text nodes", () => {
    expect(buildTextPositionMap(p(br()), 1)).toEqual({ text: "", positions: [] });
    expect(buildTextPositionMap(p(), 1)).toEqual({ text: "", positions: [] });
  });
});

describe("parentOffsetToTextOffset", () => {
  it.each([
    { parentOffset: 0, expected: 0 },
    { parentOffset: 1, expected: 1 },
    { parentOffset: 2, expected: 2 }, // at the hard break
    { parentOffset: 3, expected: 2 }, // after the hard break
    { parentOffset: 4, expected: 3 },
    { parentOffset: 5, expected: 4 }, // at the math atom
    { parentOffset: 6, expected: 4 }, // after the math atom
    { parentOffset: 7, expected: 5 }, // end of content
  ])("maps parent offset $parentOffset to text offset $expected", ({ parentOffset, expected }) => {
    expect(parentOffsetToTextOffset(mixed, parentOffset)).toBe(expected);
  });

  it("maps offsets in a text-only block one-to-one", () => {
    const block = p(text("hey"));
    expect(parentOffsetToTextOffset(block, 0)).toBe(0);
    expect(parentOffsetToTextOffset(block, 3)).toBe(3);
  });

  it("returns 0 for an empty block", () => {
    expect(parentOffsetToTextOffset(p(), 0)).toBe(0);
  });
});
