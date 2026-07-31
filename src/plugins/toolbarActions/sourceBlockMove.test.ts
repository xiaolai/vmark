/**
 * Structure-aware line operations — code-fence awareness.
 *
 * @coordinates-with sourceBlockMove.ts — duplicateNeedsHardBreak
 * @module plugins/toolbarActions/sourceBlockMove.test
 */
import { describe, it, expect } from "vitest";
import { duplicateNeedsHardBreak } from "./sourceBlockMove";

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
