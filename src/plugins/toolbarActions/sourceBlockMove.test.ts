/**
 * Structure-aware line operations — code-fence awareness.
 *
 * @coordinates-with sourceBlockMove.ts — duplicateNeedsHardBreak
 * @module plugins/toolbarActions/sourceBlockMove.test
 */
import { describe, it, expect } from "vitest";
import { duplicateNeedsHardBreak, moveBlockAware } from "./sourceBlockMove";

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

  it("still reorders content WITHIN one fence", () => {
    expect(moveBlockAware(["```", "a", "b", "```"], { start: 2, end: 2 }, "up")).toEqual([
      "```", "b", "a", "```",
    ]);
  });

  it("still moves ordinary lines with no fence involved", () => {
    expect(moveBlockAware(["a", "b"], { start: 1, end: 1 }, "up")).toEqual(["b", "a"]);
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
    expect(moveBlockAware(["one", "", "two"], { start: 0, end: 0 }, "down")).toEqual([
      "two", "", "one",
    ]);
  });
});
