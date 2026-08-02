import { describe, it, expect } from "vitest";
import { sourceBlockSpan, selectionBlockSpan } from "./blockSpan";

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

  it("accepts a REVERSED range, since a selection can be dragged upward", () => {
    const l = lines("a\n\nb\nc");
    expect(sourceBlockSpan(l, 3, 2)).toEqual({ start: 2, end: 3 });
  });

  it("handles a document of one blank line", () => {
    expect(sourceBlockSpan([""], 0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("handles a genuinely EMPTY array", () => {
    // The case above passes `[""]` — one empty string, not an empty array — so
    // it went on passing against the implementation that threw here.
    expect(sourceBlockSpan([], 0, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe("selectionBlockSpan", () => {
  // "alpha" @0, "" @6, "beta" @7. A selection of exactly `alpha\n` ends at
  // offset 6 — the START of the blank line. Reading the last line from `to`
  // lands on that blank, widens through it, and swallows `beta`; reading from
  // `to - 1` stays on `alpha`. The two answers DIFFER here, which is what makes
  // this a regression test rather than a restatement.
  const lines = ["alpha", "", "beta"];
  const lineNumberAt = (offset: number): number => (offset < 6 ? 1 : offset < 7 ? 2 : 3);

  it("stops at the block boundary when the selection ends at a line start", () => {
    expect(selectionBlockSpan(lines, 0, 6, lineNumberAt)).toEqual({ start: 0, end: 0 });
  });

  it("differs from the naive reading, proving the off-by-one is what is tested", () => {
    // The naive version resolved the last line from `to` rather than `to - 1`,
    // landing on the blank separator. It used to swallow `beta` outright; the
    // per-endpoint blank rule now stops that, but the naive span still drags
    // the separator line in — which is what the `to - 1` rule exists to avoid.
    const naive = sourceBlockSpan(lines, lineNumberAt(0) - 1, lineNumberAt(6) - 1);
    expect(naive).not.toEqual(selectionBlockSpan(lines, 0, 6, lineNumberAt));
    expect(naive).toEqual({ start: 0, end: 1 }); // includes the separator
  });

  it("treats a caret as a single point, not a range", () => {
    expect(selectionBlockSpan(lines, 7, 7, lineNumberAt)).toEqual({ start: 2, end: 2 });
  });

  it("widens to the whole block a mid-line selection sits in", () => {
    expect(selectionBlockSpan(lines, 1, 3, lineNumberAt)).toEqual({ start: 0, end: 0 });
  });
});

describe("sourceBlockSpan treats a fence as a hard boundary", () => {
  it("does not widen up through a closing fence", () => {
    // Markdown does not require a blank line after ```, so the paragraph below
    // one used to expand across the whole code block and hand it to the action.
    const l = lines("```js\ncode();\n```\nparagraph here");
    expect(sourceBlockSpan(l, 3, 3)).toEqual({ start: 3, end: 3 });
  });

  it("does not widen down through an opening fence", () => {
    const l = lines("paragraph here\n```js\ncode();\n```");
    expect(sourceBlockSpan(l, 0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("keeps a fence containing a blank line whole", () => {
    const l = lines("```\na\n\nb\n```");
    expect(sourceBlockSpan(l, 1, 1)).toEqual({ start: 0, end: 4 });
  });

  it("still widens normally where no fence is involved", () => {
    expect(sourceBlockSpan(lines("one\ntwo\nthree"), 1, 1)).toEqual({ start: 0, end: 2 });
  });

  it("does not let a tilde run close a backtick fence", () => {
    const l = lines("```\n~~~\ncode\n```\nafter");
    expect(sourceBlockSpan(l, 4, 4)).toEqual({ start: 4, end: 4 });
  });
});

describe("sourceBlockSpan resolves each ENDPOINT independently", () => {
  // Blank endpoints were honoured only for collapsed selections; a range with
  // one blank end expanded straight through it into a block the user never
  // touched.
  it("a blank START endpoint stays on the blank line", () => {
    // Selecting the separator and "b" must not swallow "a".
    expect(sourceBlockSpan(["a", "", "b"], 1, 2)).toEqual({ start: 1, end: 2 });
  });

  it("a blank END endpoint stays on the blank line", () => {
    // Selecting "a" and the separator must not swallow "b".
    expect(sourceBlockSpan(["a", "", "b"], 0, 1)).toEqual({ start: 0, end: 1 });
  });

  it("a mixed fence/paragraph selection widens the paragraph END too", () => {
    // The fence branch returned early with only the fence side expanded,
    // leaving the paragraph endpoint mid-block — a partial replacement.
    const l = ["```", "x", "```", "para one", "para two"];
    expect(sourceBlockSpan(l, 1, 3)).toEqual({ start: 0, end: 4 });
  });

  it("a mixed paragraph/fence selection widens the paragraph START too", () => {
    const l = ["para one", "para two", "```", "x", "```"];
    expect(sourceBlockSpan(l, 1, 3)).toEqual({ start: 0, end: 4 });
  });
});
