// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";
import { noEmptyLinkText } from "../noEmptyLinkText";
import type { Root, Link } from "mdast";

/** A synthetic mdast carries no source, so the line index it is linted with is empty. */
const EMPTY_INDEX = { lines: [], lineOffsets: [] };

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

    const diagnostics = noEmptyLinkText("", mdast, EMPTY_INDEX);
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

    const diagnostics = noEmptyLinkText("", mdast, EMPTY_INDEX);
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

    const diagnostics = noEmptyLinkText("", mdast, EMPTY_INDEX);
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

    const diagnostics = noEmptyLinkText("", mdast, EMPTY_INDEX);
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

    const diagnostics = noEmptyLinkText("", mdast, EMPTY_INDEX);
    expect(diagnostics).toHaveLength(0);
  });
});

// Audit 20260907 round 3 (#818): inline code and images were counted as
// content and then TRIMMED away, so a link whose only content was a
// whitespace-only code span or an empty-alt image was reported as empty.
describe("E06 — content that is not text", () => {
  const flagged = (input: string) => lintMarkdown(input).some((d) => d.ruleId === "E06");

  it.each([
    { name: "a whitespace-only inline code span", input: "[` `](https://example.com)\n" },
    { name: "an image with an empty alt", input: "[![](/a.png)](https://example.com)\n" },
    { name: "an image with a whitespace alt", input: "[![ ](/a.png)](https://example.com)\n" },
    { name: "an image reference with an empty alt", input: "[![][i]](https://e.com)\n\n[i]: /a.png\n" },
  ])("$name is content, not emptiness", ({ input }) => {
    expect(flagged(input)).toBe(false);
  });

  it.each([
    { name: "genuinely empty", input: "[](https://example.com)\n" },
    { name: "whitespace-only text", input: "[   ](https://example.com)\n" },
  ])("$name is still reported", ({ input }) => {
    expect(flagged(input)).toBe(true);
  });
});

// Audit 20260907 round 3 (#819) claimed a link holding only a REFERENCED image
// bypasses E06. It does not, for the same reason W04 covers reference links:
// the pipeline resolves `![alt][ref]` into an `image` before rules run. Pinned
// because that is another module's property, and losing it would make this rule
// report every reference-image link as empty.
describe("E06 — a referenced image is an image", () => {
  it("does not report a link whose only content is a referenced image", () => {
    const out = lintMarkdown("[![alt][img]](https://e.com)\n\n[img]: /a.png\n");
    expect(out.filter((d) => d.ruleId === "E06")).toHaveLength(0);
  });

  it("does not report one whose reference has no definition either", () => {
    // With no definition CommonMark keeps `![alt][missing]` as literal TEXT,
    // which is content by any reading.
    const out = lintMarkdown("[![alt][missing]](https://e.com)\n");
    expect(out.filter((d) => d.ruleId === "E06")).toHaveLength(0);
  });
});
