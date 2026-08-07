// @vitest-environment node
/**
 * Footnote Save — Formatting Preservation Tests
 *
 * Regression tests for issue #86: footnote content must preserve inline
 * formatting (bold, italic, links, etc.) when saved via the popup.
 *
 * The fix changed handleSave from creating a plain text node to using
 * parseMarkdown, which round-trips markdown → MDAST → ProseMirror.
 * These tests verify that parseMarkdown correctly preserves formatting
 * in the context of footnote save (single-paragraph inline content).
 */

import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { testSchema } from "@/utils/markdownPipeline/testSchema";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Parse markdown and collect top-level children (simulates handleSave logic). */
function parseFootnoteContent(content: string): PMNode[] {
  const parsedDoc = parseMarkdown(testSchema, content);
  const nodes: PMNode[] = [];
  parsedDoc.forEach((child) => nodes.push(child));
  return nodes;
}

/** Check whether any text node inside a paragraph carries a given mark. */
function hasMark(paragraph: PMNode, markName: string): boolean {
  let found = false;
  paragraph.forEach((child) => {
    if (child.marks.some((m) => m.type.name === markName)) found = true;
  });
  return found;
}

/** Find a text node inside a paragraph that carries a given mark. */
function findMarkedNode(paragraph: PMNode, markName: string): PMNode | null {
  let result: PMNode | null = null;
  paragraph.forEach((child) => {
    if (!result && child.marks.some((m) => m.type.name === markName)) result = child;
  });
  return result;
}

/** Get the href attribute from a link mark on a node. */
function getLinkHref(node: PMNode): string | null {
  const linkMark = node.marks.find((m) => m.type.name === "link");
  return linkMark ? linkMark.attrs.href : null;
}

describe("Footnote save — formatting preservation", () => {
  describe("Basic formatting marks", () => {
    it("preserves plain text without formatting", () => {
      const nodes = parseFootnoteContent("Hello world");
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      const para = nodes[0];
      expect(para.type.name).toBe("paragraph");
      expect(para.textContent).toBe("Hello world");
    });

    it("preserves bold formatting", () => {
      const nodes = parseFootnoteContent("**bold text**");
      const para = nodes[0];
      expect(hasMark(para, "bold")).toBe(true);
      const boldNode = findMarkedNode(para, "bold");
      expect(boldNode?.textContent).toBe("bold text");
    });

    it("preserves italic formatting", () => {
      const nodes = parseFootnoteContent("*italic text*");
      const para = nodes[0];
      expect(hasMark(para, "italic")).toBe(true);
      const italicNode = findMarkedNode(para, "italic");
      expect(italicNode?.textContent).toBe("italic text");
    });

    it("preserves bold and italic combined", () => {
      const nodes = parseFootnoteContent("***bold italic***");
      const para = nodes[0];
      expect(hasMark(para, "bold")).toBe(true);
      expect(hasMark(para, "italic")).toBe(true);
    });

    it("preserves inline code", () => {
      const nodes = parseFootnoteContent("`code`");
      const para = nodes[0];
      expect(hasMark(para, "code")).toBe(true);
      const codeNode = findMarkedNode(para, "code");
      expect(codeNode?.textContent).toBe("code");
    });

    it("preserves strikethrough", () => {
      const nodes = parseFootnoteContent("~~deleted~~");
      const para = nodes[0];
      expect(hasMark(para, "strike")).toBe(true);
      const strikeNode = findMarkedNode(para, "strike");
      expect(strikeNode?.textContent).toBe("deleted");
    });

    it("preserves links with href", () => {
      const nodes = parseFootnoteContent("[link](https://example.com)");
      const para = nodes[0];
      expect(hasMark(para, "link")).toBe(true);
      const linkNode = findMarkedNode(para, "link");
      expect(linkNode?.textContent).toBe("link");
      expect(getLinkHref(linkNode!)).toBe("https://example.com");
    });
  });

  describe("Mixed formatting", () => {
    it("preserves bold and italic and link in one line", () => {
      const nodes = parseFootnoteContent(
        "This is **bold** and *italic* with a [link](https://example.com)"
      );
      const para = nodes[0];
      expect(hasMark(para, "bold")).toBe(true);
      expect(hasMark(para, "italic")).toBe(true);
      expect(hasMark(para, "link")).toBe(true);
      expect(para.textContent).toContain("bold");
      expect(para.textContent).toContain("italic");
      expect(para.textContent).toContain("link");
    });

    it("preserves formatting at start and end of content", () => {
      const nodes = parseFootnoteContent("**start** middle *end*");
      const para = nodes[0];
      expect(hasMark(para, "bold")).toBe(true);
      expect(hasMark(para, "italic")).toBe(true);
    });

    it("preserves nested bold inside italic", () => {
      const nodes = parseFootnoteContent("**bold *and italic***");
      const para = nodes[0];
      expect(hasMark(para, "bold")).toBe(true);
      expect(hasMark(para, "italic")).toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("handles empty string", () => {
      const nodes = parseFootnoteContent("");
      // Empty markdown produces a doc with zero top-level children
      // (the doc node exists but has no block children)
      // handleSave would replace footnote content with an empty fragment
      expect(nodes.length).toBe(0);
    });

    it("handles whitespace-only content", () => {
      const nodes = parseFootnoteContent("   ");
      // Whitespace-only is treated as empty by the markdown parser
      expect(nodes.length).toBe(0);
    });

    it("handles multiple paragraphs (newline-separated)", () => {
      const nodes = parseFootnoteContent("First paragraph\n\nSecond paragraph");
      expect(nodes.length).toBe(2);
      expect(nodes[0].textContent).toBe("First paragraph");
      expect(nodes[1].textContent).toBe("Second paragraph");
    });

    it("handles special characters (quotes, angle brackets, ampersands)", () => {
      const nodes = parseFootnoteContent('He said "hello" & <world>');
      const para = nodes[0];
      // Content should contain the special chars (possibly HTML-encoded in MDAST but decoded in PM)
      expect(para.textContent).toContain("hello");
      expect(para.textContent).toContain("&");
    });

    it("handles content starting with markdown formatting chars", () => {
      const nodes = parseFootnoteContent("**bold at start**");
      const para = nodes[0];
      expect(hasMark(para, "bold")).toBe(true);
      expect(para.textContent).toBe("bold at start");
    });

    it("handles content ending with markdown formatting chars", () => {
      const nodes = parseFootnoteContent("ends with *italic*");
      const para = nodes[0];
      expect(hasMark(para, "italic")).toBe(true);
      expect(para.textContent).toContain("italic");
    });

    it("handles CJK text with formatting", () => {
      const nodes = parseFootnoteContent("**中文**粗体");
      const para = nodes[0];
      expect(hasMark(para, "bold")).toBe(true);
      const boldNode = findMarkedNode(para, "bold");
      expect(boldNode?.textContent).toBe("中文");
      expect(para.textContent).toContain("粗体");
    });

    it("handles CJK text with italic", () => {
      const nodes = parseFootnoteContent("*日本語*テスト");
      const para = nodes[0];
      expect(hasMark(para, "italic")).toBe(true);
    });

    it("handles content with only formatting (no plain text)", () => {
      const nodes = parseFootnoteContent("**all bold**");
      const para = nodes[0];
      expect(hasMark(para, "bold")).toBe(true);
      expect(para.textContent).toBe("all bold");
    });

    it("handles link with special characters in URL", () => {
      const nodes = parseFootnoteContent(
        "[search](https://example.com/path?q=hello&lang=en)"
      );
      const para = nodes[0];
      const linkNode = findMarkedNode(para, "link");
      expect(linkNode).not.toBeNull();
      expect(getLinkHref(linkNode!)).toBe(
        "https://example.com/path?q=hello&lang=en"
      );
    });

    it("handles multiple inline code spans", () => {
      const nodes = parseFootnoteContent("Use `foo` and `bar`");
      const para = nodes[0];
      let codeCount = 0;
      para.forEach((child) => {
        if (child.marks.some((m) => m.type.name === "code")) codeCount++;
      });
      expect(codeCount).toBe(2);
    });
  });

  describe("Round-trip regression", () => {
    it("round-trips plain text through parse and serialize", () => {
      const input = "Simple footnote text";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });

    it("round-trips bold text through parse and serialize", () => {
      const input = "This has **bold** text";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });

    it("round-trips italic text through parse and serialize", () => {
      const input = "This has *italic* text";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });

    it("round-trips inline code through parse and serialize", () => {
      const input = "This has `code` text";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });

    it("round-trips link through parse and serialize", () => {
      const input = "[example](https://example.com)";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });

    it("round-trips mixed formatting through parse and serialize", () => {
      const input = "**bold** and *italic* and `code`";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });

    it("round-trips CJK with formatting through parse and serialize", () => {
      const input = "**中文**粗体";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });

    it("round-trips strikethrough through parse and serialize", () => {
      const input = "This has ~~deleted~~ text";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });
  });

  describe("parseFootnoteContent structure (simulating handleSave)", () => {
    it("returns paragraph nodes that can replace footnote_definition content", () => {
      const nodes = parseFootnoteContent("**formatted** footnote");
      // All returned nodes should be valid block nodes
      nodes.forEach((node) => {
        expect(node.type.name).toBe("paragraph");
      });
    });

    it("produces nodes compatible with footnote_definition content spec", () => {
      // footnote_definition expects content: "paragraph" in testSchema
      // handleSave replaces the inner content, so we need paragraph nodes
      const nodes = parseFootnoteContent("A simple footnote with a [link](url)");
      expect(nodes.length).toBe(1);
      expect(nodes[0].type.name).toBe("paragraph");
      // The paragraph should contain formatted inline content
      expect(nodes[0].childCount).toBeGreaterThan(0);
    });

    it("handles the typical footnote content patterns", () => {
      // Typical footnote: citation-like content
      const nodes = parseFootnoteContent(
        "See Smith, J. (2024). *Title of Paper*. **Journal Name**, 42(1), pp. 1-10."
      );
      const para = nodes[0];
      expect(hasMark(para, "italic")).toBe(true);
      expect(hasMark(para, "bold")).toBe(true);
      expect(para.textContent).toContain("Smith");
      expect(para.textContent).toContain("Journal Name");
    });
  });
});
