import { describe, it, expect } from "vitest";
import { parseTableRow, splitTableCells } from "./tableParser";

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
});
