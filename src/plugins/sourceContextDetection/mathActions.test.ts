import { describe, it, expect } from "vitest";
import { Text } from "@codemirror/state";
import { getBlockMathContentRange, getBlockMathUnwrapChanges } from "./mathActions";

describe("mathActions", () => {
  it("returns content range for a simple block math", () => {
    const doc = Text.of(["$$", "a + b", "$$"]);
    const info = {
      from: doc.line(1).from,
      to: doc.line(3).to,
      startLine: 1,
      endLine: 3,
      content: "a + b",
    };

    const range = getBlockMathContentRange(doc, info);
    expect(range).toEqual({ from: doc.line(2).from, to: doc.line(2).to });
  });

  it("returns unwrap changes that remove $$ delimiters", () => {
    const doc = Text.of(["$$", "a + b", "$$"]);
    const info = {
      from: doc.line(1).from,
      to: doc.line(3).to,
      startLine: 1,
      endLine: 3,
      content: "a + b",
    };

    const changes = getBlockMathUnwrapChanges(doc, info);
    expect(changes).toEqual([
      { from: doc.line(1).from, to: doc.line(1).from + 2, insert: "" },
      { from: doc.line(3).from, to: doc.line(3).from + 2, insert: "" },
    ]);
  });
});
