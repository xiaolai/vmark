// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";
import { noEmptyLinkText } from "../noEmptyLinkText";
import type { Root, Link } from "mdast";

describe("E06 noEmptyLinkText", () => {
  it.each([
    {
      name: "clean: link with text",
      input: "[click here](https://example.com)",
      expected: 0,
    },
    {
      name: "flagged: link with empty brackets",
      input: "[](https://example.com)",
      expected: 1,
    },
    {
      name: "clean: link with image inside (image counts as content)",
      input: "[![alt](image.png)](https://example.com)",
      expected: 0,
    },
    {
      name: "clean: linkReference is NOT flagged",
      input: "[text][ref]\n\n[ref]: https://example.com",
      expected: 0,
    },
    {
      name: "clean: inline image (not link) not flagged",
      input: "![](image.png)",
      expected: 0,
    },
    {
      name: "flagged: multiple empty link texts",
      input: "[](https://a.com) and [](https://b.com)",
      expected: 2,
    },
    {
      name: "clean: link with only nested inline code",
      input: "[`code`](https://example.com)",
      expected: 0,
    },
    {
      name: "clean: empty document produces no diagnostics",
      input: "",
      expected: 0,
    },
    {
      name: "flagged: link with only whitespace text",
      input: "[ ](https://example.com)",
      expected: 1,
    },
  ])("$name → $expected E06 diagnostic(s)", ({ input, expected }) => {
    const result = lintMarkdown(input);
    const matches = result.filter((d) => d.ruleId === "E06");
    expect(matches.length).toBe(expected);
  });

  it("diagnostic has correct severity, uiHint, and messageKey", () => {
    const result = lintMarkdown("[](https://example.com)");
    const d = result.find((d) => d.ruleId === "E06");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.uiHint).toBe("exact");
    expect(d!.messageKey).toBe("lint.E06");
    expect(d!.line).toBe(1);
  });

  it("clean: link with nested strong text extracts content recursively", () => {
    // [**bold**](url) — the strong node has children, exercising recursive extraction (lines 24-25)
    const result = lintMarkdown("[**bold**](https://example.com)");
    const matches = result.filter((d) => d.ruleId === "E06");
    expect(matches).toHaveLength(0);
  });

  it("flagged: link with empty nested emphasis counts as empty text", () => {
    // Synthetic MDAST: link with an emphasis child whose only child is whitespace text
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "https://example.com",
              children: [
                {
                  type: "emphasis",
                  children: [{ type: "text", value: "  " }],
                },
              ],
              position: {
                start: { line: 1, column: 1, offset: 0 },
                end: { line: 1, column: 30, offset: 29 },
              },
            } as unknown as Link,
          ],
        },
      ],
    };

    const diagnostics = noEmptyLinkText("", mdast);
    expect(diagnostics).toHaveLength(1);
  });

  it("clean: link with deeply nested text via emphasis extracts content", () => {
    // Synthetic MDAST: emphasis > strong > text, exercising deeper recursion
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "https://example.com",
              children: [
                {
                  type: "emphasis",
                  children: [
                    {
                      type: "strong",
                      children: [{ type: "text", value: "deep" }],
                    },
                  ],
                },
              ],
              position: {
                start: { line: 1, column: 1, offset: 0 },
                end: { line: 1, column: 30, offset: 29 },
              },
            } as unknown as Link,
          ],
        },
      ],
    };

    const diagnostics = noEmptyLinkText("", mdast);
    expect(diagnostics).toHaveLength(0);
  });

  it("clean: link with image child (null alt) uses 'img' fallback", () => {
    // Exercises the `child.alt ?? "img"` branch (line 23)
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "https://example.com",
              children: [
                {
                  type: "image",
                  url: "photo.png",
                  alt: null,
                },
              ],
              position: {
                start: { line: 1, column: 1, offset: 0 },
                end: { line: 1, column: 30, offset: 29 },
              },
            } as unknown as Link,
          ],
        },
      ],
    };

    const diagnostics = noEmptyLinkText("", mdast);
    // Image with null alt falls back to "img", so link is not empty
    expect(diagnostics).toHaveLength(0);
  });

  it("uses offset fallback when position.start.offset is undefined", () => {
    // Exercises the `offset ?? 0` branch (line 48)
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "https://example.com",
              children: [{ type: "text", value: "" }],
              position: {
                start: { line: 1, column: 1 },
                end: { line: 1, column: 25 },
              },
            } as unknown as Link,
          ],
        },
      ],
    };

    const diagnostics = noEmptyLinkText("", mdast);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].offset).toBe(0);
  });

  it("skips link nodes without position", () => {
    const mdast: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "https://example.com",
              children: [],
              // No position — should be skipped
            } as Link,
          ],
        },
      ],
    };

    const diagnostics = noEmptyLinkText("", mdast);
    expect(diagnostics).toHaveLength(0);
  });
});
