import { describe, it, expect } from "vitest";
import { sourceBlockSpan } from "./blockSpan";

/** `sourceBlockSpan` works on lines, so the fixtures are line arrays. */
const lines = (s: string): string[] => s.split("\n");

describe("sourceBlockSpan", () => {
  it("expands a mid-paragraph selection to the whole paragraph", () => {
    expect(sourceBlockSpan(lines("The quick brown fox"), 0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("expands to every line of a multi-line paragraph", () => {
    const l = lines("one\ntwo\nthree");
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 0, end: 2 });
  });

  it("stops at a blank line — a blank separates blocks", () => {
    const l = lines("First para\n\nSecond para\n\nThird para");
    expect(sourceBlockSpan(l, 2, 2)).toEqual({ start: 2, end: 2 });
  });

  it("takes the WHOLE list when the selection is in one item", () => {
    // Wrapping a single item shatters the list into list / wrapped-item / list.
    const l = lines("- one\n- two\n- three");
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 0, end: 2 });
  });

  it("takes the whole list including nested items", () => {
    const l = lines("- outer\n  - inner\n- last");
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 0, end: 2 });
  });

  it("spans every block a multi-block selection touches", () => {
    const l = lines("First para\n\nSecond para\n\nThird para");
    expect(sourceBlockSpan(l, 0, 2)).toEqual({ start: 0, end: 2 });
  });

  it("keeps a blockquote whole", () => {
    const l = lines("> quoted one\n> quoted two");
    expect(sourceBlockSpan(l, 0, 0)).toEqual({ start: 0, end: 1 });
  });

  it("handles a selection already covering the whole document", () => {
    const l = lines("only line");
    expect(sourceBlockSpan(l, 0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("returns the blank line itself when the selection is on one", () => {
    const l = lines("a\n\nb");
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 1, end: 1 });
  });

  it("clamps out-of-range indices rather than throwing", () => {
    const l = lines("a\nb");
    expect(sourceBlockSpan(l, -5, 99)).toEqual({ start: 0, end: 1 });
  });

  it("handles an empty document", () => {
    expect(sourceBlockSpan([""], 0, 0)).toEqual({ start: 0, end: 0 });
  });
});
