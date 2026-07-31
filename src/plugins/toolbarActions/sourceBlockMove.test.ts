/**
 * Structure-aware line operations — code-fence awareness.
 *
 * @coordinates-with sourceBlockMove.ts — duplicateNeedsHardBreak
 * @module plugins/toolbarActions/sourceBlockMove.test
 */
import { describe, it, expect } from "vitest";
import { moveBlockAware } from "./sourceBlockMove";
import { duplicateNeedsHardBreak, joinWouldFuseBlocks } from "./sourceLineClassifier";

describe("duplicateNeedsHardBreak inside a code fence", () => {
  const fenced = ["```js", "const a = 1;", "```", "", "paragraph"];

  it("does NOT add a hard break to a line inside a fence", () => {
    // The backslash is markdown syntax; in a fence it is a stray character in
    // the user's source code.
    expect(duplicateNeedsHardBreak(fenced, 1)).toBe(false);
  });

  it("does not add one on the delimiter lines either", () => {
    expect(duplicateNeedsHardBreak(fenced, 0)).toBe(false);
    expect(duplicateNeedsHardBreak(fenced, 2)).toBe(false);
  });

  it("still adds one to a real paragraph outside the fence", () => {
    expect(duplicateNeedsHardBreak(fenced, 4)).toBe(true);
  });

  it("treats an unclosed fence as running to the end", () => {
    expect(duplicateNeedsHardBreak(["```", "code", "more"], 2)).toBe(false);
  });
});

describe("moveBlockAware refuses to disturb a fence", () => {
  const fence = ["```", "code", "```"];

  it("does not hoist content out of a fence", () => {
    // This produced ["code","```","```"] — the fence destroyed and everything
    // after it exposed as code. `moveLineUp` is on the code-block allow-list,
    // so the refusal has to happen here.
    expect(moveBlockAware(fence, { start: 1, end: 1 }, "up")).toBeNull();
  });

  it("does not push content out of a fence", () => {
    expect(moveBlockAware(fence, { start: 1, end: 1 }, "down")).toBeNull();
  });

  it("does not move a delimiter itself", () => {
    expect(moveBlockAware(["a", "```", "b", "```"], { start: 1, end: 1 }, "up")).toBeNull();
  });

  it("does not move an outside line INTO a fence", () => {
    expect(moveBlockAware(["para", "```", "x", "```"], { start: 0, end: 0 }, "down")).toBeNull();
  });

  it("still reorders content WITHIN one fence, reporting the landing line", () => {
    expect(moveBlockAware(["```", "a", "b", "```"], { start: 2, end: 2 }, "up")).toEqual({
      lines: ["```", "b", "a", "```"],
      selectionStart: 1,
    });
  });

  it("still moves ordinary lines with no fence involved", () => {
    expect(moveBlockAware(["a", "b"], { start: 1, end: 1 }, "up")).toEqual({
      lines: ["b", "a"],
      selectionStart: 0,
    });
  });
});

describe("moveBlockAware and blank lines inside a fence", () => {
  it("refuses a move whose BLOCK EXPANSION would absorb the delimiters", () => {
    // A blank line inside the fence put this on the whole-block path, where
    // `blockAround` swallowed both delimiters and produced
    // ["b","```","","```","a"] — the fence destroyed. The immediate-neighbour
    // guard cannot see that, because the neighbour is just a blank line.
    expect(moveBlockAware(["```", "a", "", "b", "```"], { start: 1, end: 1 }, "down")).toBeNull();
  });

  it("refuses the mirrored upward move", () => {
    expect(moveBlockAware(["```", "a", "", "b", "```"], { start: 3, end: 3 }, "up")).toBeNull();
  });

  it("still swaps real paragraphs across a blank line", () => {
    expect(moveBlockAware(["one", "", "two"], { start: 0, end: 0 }, "down")).toEqual({
      lines: ["two", "", "one"],
      selectionStart: 2,
    });
  });
});

describe("joinWouldFuseBlocks sees through container prefixes", () => {
  // `listIndent` on the raw line cannot see "> - one" as a list item, so a
  // join produced the malformed "> - one > - two".
  it("refuses to fuse two QUOTED list items", () => {
    expect(joinWouldFuseBlocks(["> - one", "> - two"], 0, 0)).toBe(true);
  });

  it("refuses to fuse a paragraph with a heading", () => {
    expect(joinWouldFuseBlocks(["para", "# head"], 0, 0)).toBe(true);
  });

  it("refuses to fuse a paragraph with a thematic break", () => {
    expect(joinWouldFuseBlocks(["para", "---"], 0, 0)).toBe(true);
  });

  it("refuses to fuse a paragraph with a table row", () => {
    expect(joinWouldFuseBlocks(["para", "| a | b |"], 0, 0)).toBe(true);
  });

  it("still allows joining two plain quoted lines", () => {
    // Two lines of one quoted paragraph are the case join exists for.
    expect(joinWouldFuseBlocks(["> one", "> two"], 0, 0)).toBe(false);
  });

  it("multi-line selection: a structural line anywhere after the first refuses", () => {
    expect(joinWouldFuseBlocks(["a", "b", "# c"], 0, 2)).toBe(true);
  });
});

describe("duplicateNeedsHardBreak treats structural lines as siblings", () => {
  it.each([
    { line: "---", label: "thematic break" },
    { line: "* * *", label: "spaced thematic break" },
    { line: "    code", label: "indented code" },
    { line: "\tcode", label: "tab-indented code" },
    { line: "<div>", label: "HTML block" },
    { line: "$$", label: "math delimiter" },
  ])("$label duplicates without a backslash", ({ line }) => {
    // Appending "\" turned "---" into "---\" — a paragraph, not a break.
    expect(duplicateNeedsHardBreak([line], 0)).toBe(false);
  });

  it("a plain paragraph line still needs the break", () => {
    expect(duplicateNeedsHardBreak(["plain text"], 0)).toBe(true);
  });

  it("a QUOTED paragraph still needs the break", () => {
    expect(duplicateNeedsHardBreak(["> quoted text"], 0)).toBe(true);
  });

  it("a quoted thematic break does NOT", () => {
    expect(duplicateNeedsHardBreak(["> ---"], 0)).toBe(false);
  });
});
