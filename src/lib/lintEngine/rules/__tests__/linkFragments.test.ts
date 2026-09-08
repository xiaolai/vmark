// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lintMarkdown } from "../../linter";
import { linkFragments } from "../linkFragments";
import type { Root, Link } from "mdast";

/** A synthetic mdast carries no source, so the line index it is linted with is empty. */
const EMPTY_INDEX = { lines: [], lineOffsets: [] };

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

    const diagnostics = linkFragments("", mdast, EMPTY_INDEX);
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

    const diagnostics = linkFragments("", mdast, EMPTY_INDEX);
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

    const diagnostics = linkFragments("", mdast, EMPTY_INDEX);
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

    const diagnostics = linkFragments("", mdast, EMPTY_INDEX);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].offset).toBe(0);
  });
});

// Audit 20260907 round 3 (#810/#812/#814).
describe("W04 — what a heading's slug is actually made of", () => {
  const anchors = (input: string) => lintMarkdown(input).filter((d) => d.ruleId === "W04");

  it("ignores raw inline HTML in a heading, as the rendered anchor does (#810)", () => {
    expect(anchors("# Hello <b>World</b>\n\n[x](#hello-world)\n")).toHaveLength(0);
  });

  it("still counts inline code as heading text", () => {
    expect(anchors("# The `run` flag\n\n[x](#the-run-flag)\n")).toHaveLength(0);
  });

  it("resolves a percent-encoded fragment against the heading it names (#814)", () => {
    expect(anchors("# Café\n\n[x](#caf%C3%A9)\n")).toHaveLength(0);
  });

  it("survives a malformed percent-encoding rather than throwing (#814)", () => {
    expect(anchors("# Real\n\n[x](#100%)\n")).toHaveLength(1);
  });

  it("still numbers duplicate headings, so #title-1 resolves (#812)", () => {
    expect(anchors("# Title\n\n# Title\n\n[a](#title) [b](#title-1)\n")).toHaveLength(0);
  });

  it("still reports a fragment no heading provides", () => {
    expect(anchors("# Real\n\n[x](#nope)\n")).toHaveLength(1);
  });
});

// Audit 20260907 round 3 (#813) claimed reference-style links bypass W04. They
// do not, and the reason is one the rule depends on WITHOUT saying so: the
// pipeline's reference resolution rewrites `[text][ref]` into a `link` node
// before rules run, so this rule's `visit(mdast, "link")` already sees it. That
// is a property of another module, which is exactly why it is pinned here — if
// resolution ever stops running, W04 would silently stop covering half the
// links in a document and every existing test would still pass.
describe("W04 — reference-style links are checked too", () => {
  it("flags a reference whose definition names a missing anchor", () => {
    const out = lintMarkdown("# Real\n\nSee [text][r]\n\n[r]: #nope\n");
    expect(out.filter((d) => d.ruleId === "W04")).toHaveLength(1);
  });

  it("accepts one whose definition names a real anchor", () => {
    const out = lintMarkdown("# Real\n\nSee [text][r]\n\n[r]: #real\n");
    expect(out.filter((d) => d.ruleId === "W04")).toHaveLength(0);
  });

  it("checks a collapsed reference the same way", () => {
    const out = lintMarkdown("# Real\n\nSee [nope][]\n\n[nope]: #missing\n");
    expect(out.filter((d) => d.ruleId === "W04")).toHaveLength(1);
  });
});
