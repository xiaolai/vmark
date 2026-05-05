import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { SourcePeekRange } from "@/stores/sourcePeekStore";

vi.mock("@/utils/sourcePeek", () => ({
  serializeSourcePeekRange: (state: EditorState, range: SourcePeekRange) =>
    state.doc.textBetween(range.from, range.to, "\n"),
}));

import { extractSurroundingContext } from "./extractContext";

const schema = new Schema({
  nodes: {
    doc: { content: "block*" },
    paragraph: { content: "text*", group: "block" },
    text: { inline: true },
  },
});

function createState(blocks: string[]) {
  const nodes = blocks.map((text) =>
    schema.node("paragraph", null, text ? [schema.text(text)] : [])
  );
  return EditorState.create({
    doc: schema.node("doc", null, nodes),
    schema,
  });
}

describe("extractSurroundingContext", () => {
  it("returns empty result when radius is 0", () => {
    const state = createState(["A", "B", "C"]);
    expect(extractSurroundingContext(state, { from: 1, to: 2 }, 0)).toEqual({
      before: "",
      after: "",
    });
  });

  it("returns empty result when radius is negative", () => {
    const state = createState(["A", "B", "C"]);
    expect(extractSurroundingContext(state, { from: 1, to: 2 }, -1)).toEqual({
      before: "",
      after: "",
    });
  });

  it("returns empty result when document has no children", () => {
    const state = createState([]);
    expect(extractSurroundingContext(state, { from: 0, to: 0 }, 2)).toEqual({
      before: "",
      after: "",
    });
  });

  it("returns empty 'before' and up-to-radius 'after' when range is in the first block", () => {
    // Block positions for ["A","B","C","D","E"] (each nodeSize=3):
    // 0: 0..3, 1: 3..6, 2: 6..9, 3: 9..12, 4: 12..15
    const state = createState(["A", "B", "C", "D", "E"]);
    const result = extractSurroundingContext(state, { from: 1, to: 2 }, 2);
    expect(result.before).toBe("");
    expect(result.after).toBe("B\n\nC");
  });

  it("returns up-to-radius 'before' and empty 'after' when range is in the last block", () => {
    const state = createState(["A", "B", "C", "D", "E"]);
    const result = extractSurroundingContext(state, { from: 13, to: 14 }, 2);
    expect(result.before).toBe("C\n\nD");
    expect(result.after).toBe("");
  });

  it("walks from fromIndex-1 backward and toIndex+1 forward when range spans multiple blocks", () => {
    // Blocks: A B C D E F (indices 0..5, each nodeSize=3)
    // 0: 0..3, 1: 3..6, 2: 6..9, 3: 9..12, 4: 12..15, 5: 15..18
    // Range from=7 (inside C, index 2) to=13 (inside E, index 4)
    const state = createState(["A", "B", "C", "D", "E", "F"]);
    const result = extractSurroundingContext(state, { from: 7, to: 13 }, 2);
    expect(result.before).toBe("A\n\nB");
    expect(result.after).toBe("F");
    // Spanned blocks (C, D, E) must NOT appear in either side
    expect(result.before).not.toMatch(/[CDE]/);
    expect(result.after).not.toMatch(/[CDE]/);
  });

  it("skips blank/whitespace-only blocks without counting them toward the radius", () => {
    // Blocks: "X", "", "A", "", "Y"
    // Sizes: 3,2,3,2,3 → offsets 0,3,5,8,10; ends 3,5,8,10,13
    const state = createState(["X", "", "A", "", "Y"]);
    const result = extractSurroundingContext(state, { from: 6, to: 6 }, 1);
    expect(result.before).toBe("X");
    expect(result.after).toBe("Y");
  });

  it("falls back to last child index when range is beyond the document end", () => {
    const state = createState(["A", "B", "C"]);
    const result = extractSurroundingContext(state, { from: 100, to: 200 }, 2);
    expect(result.before).toBe("A\n\nB");
    expect(result.after).toBe("");
  });

  it("collects exactly one neighbour on each side when radius is 1", () => {
    // Blocks A,B,C — range inside B (block 1)
    const state = createState(["A", "B", "C"]);
    const result = extractSurroundingContext(state, { from: 4, to: 5 }, 1);
    expect(result.before).toBe("A");
    expect(result.after).toBe("C");
  });
});
