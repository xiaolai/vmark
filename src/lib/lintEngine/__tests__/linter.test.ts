import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../linter";

describe("lintMarkdown", () => {
  it("returns empty array for valid markdown", () => {
    const result = lintMarkdown("# Hello\n\nThis is valid markdown.");
    expect(result).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    const result = lintMarkdown("");
    expect(result).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    const result = lintMarkdown("   \n  \n  ");
    expect(result).toEqual([]);
  });

  it("returns empty array for frontmatter-only document", () => {
    const result = lintMarkdown("---\ntitle: test\n---");
    expect(result).toEqual([]);
  });

  it("each diagnostic has a unique id", () => {
    // Once rules are added, this will catch id collisions
    const source = "# Title\n\n## Valid\n\nSome text.";
    const result = lintMarkdown(source);
    const ids = result.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe("diagnostic ordering", () => {
    it("sorts diagnostics by line even when rules emit them out of order", () => {
      // noMissingSpaceAtx (E04) runs before noUndefinedRefs (E01) in allRules,
      // so the raw collection order here is [E04@line5, E01@line1] —
      // line-descending. The orchestrator must return them line-ascending.
      const source = [
        "[first][missing-a] text",
        "",
        "some text",
        "",
        "#NoSpaceHeading",
      ].join("\n");
      const result = lintMarkdown(source);
      expect(result.map((d) => d.id)).toEqual(["E01-1-1", "E04-5-1"]);
      expect(result.map((d) => d.line)).toEqual([1, 5]);
    });

    it("keeps diagnostics line-ascending when raw order is already correct", () => {
      // Raw order [E04@line1, E01@line3] is already sorted; guards against
      // comparator mutations (e.g. a.line + b.line) that swap ordered pairs.
      const source = ["#Bad", "", "[x][missing]"].join("\n");
      const result = lintMarkdown(source);
      expect(result.map((d) => d.id)).toEqual(["E04-1-1", "E01-3-1"]);
    });

    it("orders by line before column when the two orderings conflict", () => {
      // E01 sits at column 11 of line 1; E04 at column 1 of line 5. The line
      // comparison must dominate: line 1 first despite its larger column.
      const source = [
        "text like [a][gone] here",
        "",
        "",
        "",
        "#Bad",
      ].join("\n");
      const result = lintMarkdown(source);
      expect(result.map((d) => [d.line, d.column])).toEqual([
        [1, 11],
        [5, 1],
      ]);
    });

    it("sorts same-line diagnostics by column when rules emit them column-descending", () => {
      // noReversedLink (E03) runs before noUndefinedRefs (E01), so the raw
      // order is [E03@col20, E01@col1]; the sort must flip them.
      const source = "[x][nope] and then (click)[http://example.com]";
      const result = lintMarkdown(source);
      expect(result.map((d) => d.id)).toEqual(["E01-1-1", "E03-1-20"]);
      expect(result.map((d) => d.column)).toEqual([1, 20]);
    });

    it("keeps same-line diagnostics column-ascending when raw order is already correct", () => {
      // Raw order [E04@col1, E01@col6] is already sorted; a mutated column
      // comparator (a.column + b.column) would reverse the ordered pair.
      const source = "#Bad [x][nope]";
      const result = lintMarkdown(source);
      expect(result.map((d) => d.id)).toEqual(["E04-1-1", "E01-1-6"]);
    });
  });

  describe("shared line index offsets", () => {
    it("computes absolute source offsets through the precomputed line offsets", () => {
      // E01 derives `offset` from the orchestrator's lineOffsets: line 3
      // starts at 9 ("# Title\n" = 8, "\n" = 1), plus "see " = 4.
      const source = ["# Title", "", "see [ref][undefined-label] here"].join(
        "\n"
      );
      const [diag] = lintMarkdown(source);
      expect(diag.ruleId).toBe("E01");
      expect(diag.line).toBe(3);
      expect(diag.column).toBe(5);
      expect(diag.offset).toBe(13);
      expect(diag.endOffset).toBe(35);
      // Round-trip: the offsets really delimit the reference in the source.
      expect(source.slice(diag.offset, diag.endOffset)).toBe(
        "[ref][undefined-label]"
      );
    });

    it("accumulates each preceding line's length plus its newline", () => {
      const source = ["#Bad", "", "[x][missing]"].join("\n");
      const e01 = lintMarkdown(source).find((d) => d.ruleId === "E01");
      expect(e01).toBeDefined();
      expect(e01?.offset).toBe(6); // "#Bad\n" (5) + "\n" (1)
      expect(source.slice(e01!.offset, e01!.endOffset)).toBe("[x][missing]");
    });
  });

  it("handles a 5000-line document without error", () => {
    // Behavioral, not a wall-clock budget: a bare `performance.now()` assertion
    // flakes under parallel CPU load (the work is fine, the clock isn't). A
    // catastrophic O(n²) regression still surfaces here via Vitest's per-test
    // timeout (the run hangs), and hard perf budgets live in the bench suite
    // (`pnpm bench`), which is built for CPU contention.
    const lines = Array.from({ length: 5000 }, (_, i) => `Line ${i + 1}`);
    lines[0] = "# Title";
    const source = lines.join("\n");
    const result = lintMarkdown(source);
    expect(Array.isArray(result)).toBe(true);
  });
});
