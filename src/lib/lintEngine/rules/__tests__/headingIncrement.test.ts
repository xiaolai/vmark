// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";
import { headingIncrement } from "../headingIncrement";
import type { Root, Heading } from "mdast";

describe("W01 headingIncrement", () => {
  it.each([
    {
      name: "clean: sequential h1 → h2 → h3",
      input: "# Heading 1\n\n## Heading 2\n\n### Heading 3",
      expected: 0,
    },
    {
      name: "flagged: h1 → h3 skip",
      input: "# Heading 1\n\n### Heading 3",
      expected: 1,
    },
    {
      name: "clean: decrease from h3 → h2 is fine (no skip in decrease)",
      input: "## Section\n\n### Sub\n\n## Back to H2",
      expected: 0,
    },
    {
      name: "clean: first heading is h3 (no prior context to compare)",
      input: "### Starting at H3",
      expected: 0,
    },
    {
      name: "flagged: h1 → h4 skip",
      input: "# Title\n\n#### Way too deep",
      expected: 1,
    },
    {
      name: "flagged: multiple skips produce multiple diagnostics",
      input: "# H1\n\n### H3\n\n##### H5",
      expected: 2,
    },
    {
      name: "clean: h2 → h3 is fine (increment by 1)",
      input: "## Heading 2\n\n### Heading 3",
      expected: 0,
    },
    {
      name: "clean: empty document produces no diagnostics",
      input: "",
      expected: 0,
    },
    {
      name: "clean: same level repeated (h2 → h2) is fine",
      input: "## First\n\n## Second",
      expected: 0,
    },
  ])("$name → $expected W01 diagnostic(s)", ({ input, expected }) => {
    const result = lintMarkdown(input);
    const matches = result.filter((d) => d.ruleId === "W01");
    expect(matches.length).toBe(expected);
  });

  it("diagnostic has correct severity, uiHint, and messageParams", () => {
    const result = lintMarkdown("# H1\n\n### H3");
    const d = result.find((d) => d.ruleId === "W01");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("warning");
    expect(d!.uiHint).toBe("exact");
    expect(d!.messageKey).toBe("lint.W01");
    expect(d!.messageParams.from).toBe("1");
    expect(d!.messageParams.to).toBe("3");
    expect(d!.line).toBe(3);
  });

  it("skips heading without position but still updates prevDepth", () => {
    // Create synthetic MDAST with a heading that skips a level
    // but the second heading has no position — should not produce a diagnostic
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "heading",
          depth: 1,
          children: [{ type: "text", value: "H1" }],
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 5, offset: 4 },
          },
        },
        {
          type: "heading",
          depth: 3,
          children: [{ type: "text", value: "H3 no position" }],
          // No position — should be skipped without a diagnostic
        } as Heading,
        {
          type: "heading",
          depth: 5,
          children: [{ type: "text", value: "H5" }],
          position: {
            start: { line: 5, column: 1, offset: 30 },
            end: { line: 5, column: 9, offset: 38 },
          },
        },
      ],
    };

    const diagnostics = headingIncrement("", mdast);
    // The h3 (no position) is skipped for diagnostic, but prevDepth is updated to 3.
    // h5 follows h3 (skip of 2) and has position, so it produces one diagnostic.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].messageParams.from).toBe("3");
    expect(diagnostics[0].messageParams.to).toBe("5");
  });

  it("uses offset fallback when position.start.offset is undefined", () => {
    // Exercises the `offset ?? 0` branch (line 34)
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "heading",
          depth: 1,
          children: [{ type: "text", value: "H1" }],
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 5, offset: 4 },
          },
        },
        {
          type: "heading",
          depth: 3,
          children: [{ type: "text", value: "H3" }],
          position: {
            start: { line: 3, column: 1 },
            end: { line: 3, column: 7 },
          },
        } as unknown as Heading,
      ],
    };

    const diagnostics = headingIncrement("", mdast);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].offset).toBe(0);
  });
});
