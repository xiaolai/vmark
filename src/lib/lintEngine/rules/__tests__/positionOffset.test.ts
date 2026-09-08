// @vitest-environment node
//
// The `offset ?? 0` fallback five rules shared put the squiggle at CHARACTER
// ZERO — under the top of the document — whenever mdast omitted an offset.
// A test that counts diagnostics cannot see that, which is why it survived in
// four rules after being fixed in the fifth (audit 20260907 round 3).
import { describe, it, expect } from "vitest";
import { startOffset } from "../positionOffset";

describe("startOffset", () => {
  const lineOffsets = [0, 10, 25];

  it("prefers the parser's own offset", () => {
    expect(startOffset({ line: 2, column: 3, offset: 12 }, lineOffsets)).toBe(12);
  });

  it("derives it from the line index when the parser omits it", () => {
    expect(startOffset({ line: 2, column: 3 }, lineOffsets)).toBe(12);
    expect(startOffset({ line: 3, column: 1 }, lineOffsets)).toBe(25);
  });

  it("never answers 0 for a position on a later line", () => {
    expect(startOffset({ line: 3, column: 1 }, lineOffsets)).not.toBe(0);
  });

  it("falls back to the column alone when the line is off the end", () => {
    expect(startOffset({ line: 9, column: 4 }, lineOffsets)).toBe(3);
  });

  it("treats an explicit offset of 0 as an answer, not as missing", () => {
    expect(startOffset({ line: 1, column: 1, offset: 0 }, lineOffsets)).toBe(0);
  });
});
