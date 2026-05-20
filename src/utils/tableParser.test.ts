import { describe, it, expect } from "vitest";
import { parseTableRow, splitTableCells, isPipeInCodeSpan } from "./tableParser";

describe("tableParser", () => {
  describe("parseTableRow", () => {
    it("parses simple row", () => {
      expect(parseTableRow("| A | B | C |")).toEqual(["A", "B", "C"]);
    });

    it("handles row without leading pipe", () => {
      expect(parseTableRow("A | B | C |")).toEqual(["A", "B", "C"]);
    });

    it("handles row without trailing pipe", () => {
      expect(parseTableRow("| A | B | C")).toEqual(["A", "B", "C"]);
    });

    it("handles row without any pipes at start/end", () => {
      expect(parseTableRow("A | B | C")).toEqual(["A", "B", "C"]);
    });

    it("preserves escaped pipes", () => {
      expect(parseTableRow("| A \\| B | C |")).toEqual(["A \\| B", "C"]);
    });

    it("preserves pipes inside inline code", () => {
      expect(parseTableRow("| `a|b` | C |")).toEqual(["`a|b`", "C"]);
    });

    it("handles multiple backticks", () => {
      expect(parseTableRow("| ``a|b`` | C |")).toEqual(["``a|b``", "C"]);
    });

    it("handles triple backticks", () => {
      expect(parseTableRow("| ```a|b``` | C |")).toEqual(["```a|b```", "C"]);
    });

    it("handles mixed escapes and code", () => {
      expect(parseTableRow("| \\| `|` | C |")).toEqual(["\\| `|`", "C"]);
    });

    it("handles empty cells", () => {
      expect(parseTableRow("| | B | |")).toEqual(["", "B", ""]);
    });

    it("trims cell content", () => {
      expect(parseTableRow("|  A  |  B  |")).toEqual(["A", "B"]);
    });

    it("handles real-world example with function call", () => {
      expect(parseTableRow("| Function `foo|bar` | Column 2 |")).toEqual([
        "Function `foo|bar`",
        "Column 2",
      ]);
    });

    it("handles separator row", () => {
      expect(parseTableRow("| --- | :---: | ---: |")).toEqual([
        "---",
        ":---:",
        "---:",
      ]);
    });

    it("handles content with multiple code spans", () => {
      expect(
        parseTableRow("| `a|b` and `c|d` | text |")
      ).toEqual(["`a|b` and `c|d`", "text"]);
    });

    it("handles nested-looking backticks (mismatched counts)", () => {
      // ``a`b`` should be seen as code span with content a`b
      expect(parseTableRow("| ``a`b|c`` | D |")).toEqual(["``a`b|c``", "D"]);
    });

    it("preserves escaped trailing pipe", () => {
      expect(parseTableRow("| A | B \\|")).toEqual(["A", "B \\|"]);
    });

    it("handles row with only escaped pipes", () => {
      expect(parseTableRow("| A \\| B \\|")).toEqual(["A \\| B \\|"]);
    });

    // --- backslash-parity regression (issue #934) -----------------------
    //
    // Naive `endsWith("\\|")` cannot tell `\|` (escaped pipe, cell content)
    // from `\\|` (cell ends with literal `\`, then real delimiter). These
    // two cases must produce different parses.

    it("strips trailing delimiter when content ends with literal backslash before pipe", () => {
      // Source: `| \\|` — cell content is a single literal `\` character,
      // and the final `|` is the closing delimiter. Result: one cell `\`.
      expect(parseTableRow("| \\\\|")).toEqual(["\\\\"]);
    });

    it("keeps trailing pipe as content when it is an escaped pipe", () => {
      // Source: `| \|` — cell content ends with an escaped `\|`. There is
      // no closing delimiter; the escaped pipe must remain in the cell.
      expect(parseTableRow("| \\|")).toEqual(["\\|"]);
    });
  });

  describe("splitTableCells", () => {
    it("splits on unescaped pipes", () => {
      expect(splitTableCells("A | B | C")).toEqual(["A ", " B ", " C"]);
    });

    it("skips escaped pipes", () => {
      expect(splitTableCells("A \\| B | C")).toEqual(["A \\| B ", " C"]);
    });

    it("skips pipes in code spans", () => {
      expect(splitTableCells("`a|b` | C")).toEqual(["`a|b` ", " C"]);
    });

    it("handles empty string", () => {
      expect(splitTableCells("")).toEqual([""]);
    });

    it("handles no pipes", () => {
      expect(splitTableCells("just text")).toEqual(["just text"]);
    });

    it("handles consecutive pipes", () => {
      expect(splitTableCells("A||B")).toEqual(["A", "", "B"]);
    });

    it("handles escape at end", () => {
      expect(splitTableCells("A \\")).toEqual(["A \\"]);
    });

    it("handles unclosed code span", () => {
      // Unclosed code span — pipe inside should still be protected
      expect(splitTableCells("`a|b")).toEqual(["`a|b"]);
    });
  });

  describe("isPipeInCodeSpan", () => {
    // Direct tests of the helper extracted from structuralCharProtection so
    // it can be reused. Each case picks a pipeIndex and verifies whether
    // the position is inside an inline code span.

    it("returns true for a pipe inside a single-backtick span", () => {
      const text = "| `a|b` | x |";
      // Position of the inner `|` (between a and b) is 4.
      expect(text[4]).toBe("|");
      expect(isPipeInCodeSpan(text, 4)).toBe(true);
    });

    it("returns false for a structural delimiter pipe", () => {
      const text = "| `a|b` | x |";
      // Outer delimiter pipes are NOT inside a code span.
      expect(text[0]).toBe("|");
      expect(isPipeInCodeSpan(text, 0)).toBe(false);
      expect(text[8]).toBe("|");
      expect(isPipeInCodeSpan(text, 8)).toBe(false);
    });

    it("respects matching backtick run lengths (double-backtick span)", () => {
      // `` `…|…` `` form: only a matching ``-run closes the span.
      const text = "| ``a|b`` | x |";
      // The inner `|` between a and b is at index 5.
      expect(text[5]).toBe("|");
      expect(isPipeInCodeSpan(text, 5)).toBe(true);
    });

    it("treats a backslash-escaped backtick as content, not span start", () => {
      // The leading `` ` `` is escaped, so no code span opens; the `|` is
      // a normal delimiter, not inside a span.
      const text = "| \\`a|b | x |";
      // The `|` between a and b sits at index 5.
      expect(text[5]).toBe("|");
      expect(isPipeInCodeSpan(text, 5)).toBe(false);
    });

    it("handles an unclosed code span (still considered inside)", () => {
      // No closing backtick — the rest of the line stays inside the span.
      const text = "| `a|b | x |";
      expect(text[4]).toBe("|");
      expect(isPipeInCodeSpan(text, 4)).toBe(true);
    });
  });
});
