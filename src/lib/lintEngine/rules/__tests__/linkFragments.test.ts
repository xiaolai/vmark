// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";
import { linkFragments } from "../linkFragments";
import type { Root, Link } from "mdast";

describe("W04 linkFragments", () => {
  it.each([
    {
      name: "clean: fragment matches heading slug",
      input: "# Hello World\n\n[link](#hello-world)",
      expected: 0,
    },
    {
      name: "flagged: fragment does not match any heading",
      input: "# Hello World\n\n[link](#nonexistent)",
      expected: 1,
    },
    {
      name: "clean: fragment matches CJK heading slug",
      input: "# 你好世界\n\n[link](#你好世界)",
      expected: 0,
    },
    {
      name: "clean: non-fragment links are not flagged",
      input: "# Hello\n\n[link](https://example.com)",
      expected: 0,
    },
    {
      name: "clean: duplicate headings use counter suffixes",
      input: "# Title\n\n# Title\n\n[link1](#title)\n[link2](#title-1)",
      expected: 0,
    },
    {
      name: "flagged: duplicate headings — wrong suffix",
      input: "# Title\n\n# Title\n\n[link](#title-2)",
      expected: 1,
    },
    {
      name: "clean: empty document produces no diagnostics",
      input: "",
      expected: 0,
    },
    {
      name: "clean: bare # (no fragment text) is not flagged",
      input: "# Hello\n\n[top](#)",
      expected: 0,
    },
    {
      name: "flagged: heading has special chars stripped in slug",
      input: "# Hello (World)!\n\n[link](#hello-world-wrong)",
      expected: 1,
    },
    {
      name: "clean: heading special chars stripped correctly",
      input: "# Hello (World)!\n\n[link](#hello-world)",
      expected: 0,
    },
    // Issue 7: inline code nodes in headings
    {
      name: "clean: heading with inline code — fragment matches",
      input: "# Hello `world`\n\n[link](#hello-world)",
      expected: 0,
    },
    {
      name: "flagged: heading with inline code — wrong fragment",
      input: "# Hello `world`\n\n[link](#hello)",
      expected: 1,
    },
  ])("$name → $expected W04 diagnostic(s)", ({ input, expected }) => {
    const result = lintMarkdown(input);
    const matches = result.filter((d) => d.ruleId === "W04");
    expect(matches.length).toBe(expected);
  });

  it("diagnostic has correct severity, uiHint, messageKey, and messageParams", () => {
    const result = lintMarkdown("# Hello\n\n[link](#broken-anchor)");
    const d = result.find((d) => d.ruleId === "W04");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("warning");
    expect(d!.uiHint).toBe("exact");
    expect(d!.messageKey).toBe("lint.W04");
    expect(d!.messageParams.anchor).toBe("broken-anchor");
  });

  it("clean: heading with nested emphasis — fragment matches slug from recursive text extraction", () => {
    // Heading like # **bold** text produces a strong node with children
    // This exercises the recursive extractHeadingText branch (lines 20-21)
    const result = lintMarkdown("# **bold** text\n\n[link](#bold-text)");
    const matches = result.filter((d) => d.ruleId === "W04");
    expect(matches).toHaveLength(0);
  });

  it("clean: heading with deeply nested markup — recursive extraction", () => {
    // # ***bold italic*** exercises emphasis > strong > text
    const result = lintMarkdown("# ***bold italic***\n\n[link](#bold-italic)");
    const matches = result.filter((d) => d.ruleId === "W04");
    expect(matches).toHaveLength(0);
  });

  it("skips link nodes without position", () => {
    // Synthetic MDAST: link without position should be skipped
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "heading",
          depth: 1,
          children: [{ type: "text", value: "Title" }],
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 8, offset: 7 },
          },
        },
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "#nonexistent",
              children: [{ type: "text", value: "link" }],
              // No position — should be skipped
            } as Link,
          ],
        },
      ],
    };

    const diagnostics = linkFragments("", mdast);
    expect(diagnostics).toHaveLength(0);
  });

  it("skips link node where url is undefined (falls back to empty string)", () => {
    // Exercises the `node.url ?? ""` branch (line 47)
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              children: [{ type: "text", value: "link" }],
              position: {
                start: { line: 1, column: 1, offset: 0 },
                end: { line: 1, column: 10, offset: 9 },
              },
            } as unknown as Link,
          ],
        },
      ],
    };

    const diagnostics = linkFragments("", mdast);
    // url is undefined → falls back to "" → does not start with # → no diagnostic
    expect(diagnostics).toHaveLength(0);
  });

  it("extracts text from heading with nested children (emphasis/strong)", () => {
    // Exercises the recursive extractHeadingText branch at line 20-21
    // where a node has "children" array (e.g., emphasis wrapping text)
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "heading",
          depth: 1,
          children: [
            {
              type: "emphasis",
              children: [{ type: "text", value: "italic" }],
            },
            { type: "text", value: " text" },
          ],
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 15, offset: 14 },
          },
        },
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "#italic-text",
              children: [{ type: "text", value: "link" }],
              position: {
                start: { line: 3, column: 1, offset: 16 },
                end: { line: 3, column: 25, offset: 40 },
              },
            },
          ],
        },
      ],
    };

    const diagnostics = linkFragments("", mdast);
    expect(diagnostics).toHaveLength(0);
  });

  it("uses offset fallback when position.start.offset is undefined", () => {
    // Exercises the `offset ?? 0` branch (line 63)
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "heading",
          depth: 1,
          children: [{ type: "text", value: "Title" }],
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 8, offset: 7 },
          },
        },
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "#nonexistent",
              children: [{ type: "text", value: "link" }],
              position: {
                start: { line: 3, column: 1 },
                end: { line: 3, column: 20 },
              },
            } as unknown as Link,
          ],
        },
      ],
    };

    const diagnostics = linkFragments("", mdast);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].offset).toBe(0);
  });
});
