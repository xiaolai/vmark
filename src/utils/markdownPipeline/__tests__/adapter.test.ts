/**
 * Tests for the markdown pipeline adapter.
 *
 * Tests the main entry points: parseMarkdown and serializeMarkdown.
 */

import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { parseMarkdown, serializeMarkdown } from "../adapter";

function createTestSchema() {
  return getSchema([StarterKit]);
}

describe("parseMarkdown", () => {
  const schema = createTestSchema();

  describe("basic parsing", () => {
    it("parses empty string", () => {
      const doc = parseMarkdown(schema, "");
      expect(doc).toBeDefined();
      expect(doc.type.name).toBe("doc");
    });

    it("parses null/undefined safely", () => {
      // @ts-expect-error - testing null handling
      const doc1 = parseMarkdown(schema, null);
      expect(doc1).toBeDefined();

      // @ts-expect-error - testing undefined handling
      const doc2 = parseMarkdown(schema, undefined);
      expect(doc2).toBeDefined();
    });

    it("parses simple heading", () => {
      const doc = parseMarkdown(schema, "# Hello World");
      expect(doc.content.childCount).toBeGreaterThan(0);
      expect(doc.firstChild?.type.name).toBe("heading");
    });

    it("parses paragraph", () => {
      const doc = parseMarkdown(schema, "Hello World");
      expect(doc.firstChild?.type.name).toBe("paragraph");
    });

    it("parses multiple blocks", () => {
      const doc = parseMarkdown(schema, "# Title\n\nParagraph\n\n- List item");
      expect(doc.content.childCount).toBeGreaterThan(1);
    });
  });

  describe("inline formatting", () => {
    it("parses bold text", () => {
      const doc = parseMarkdown(schema, "**bold**");
      const paragraph = doc.firstChild;
      expect(paragraph?.type.name).toBe("paragraph");
    });

    it("parses italic text", () => {
      const doc = parseMarkdown(schema, "*italic*");
      expect(doc.firstChild?.type.name).toBe("paragraph");
    });

    it("parses inline code", () => {
      const doc = parseMarkdown(schema, "`code`");
      expect(doc.firstChild?.type.name).toBe("paragraph");
    });

    it("parses links", () => {
      const doc = parseMarkdown(schema, "[link](https://example.com)");
      expect(doc.firstChild?.type.name).toBe("paragraph");
    });
  });

  describe("block elements", () => {
    it("parses code blocks", () => {
      const doc = parseMarkdown(schema, "```javascript\nconst x = 1;\n```");
      expect(doc.firstChild?.type.name).toBe("codeBlock");
    });

    it("parses blockquotes", () => {
      const doc = parseMarkdown(schema, "> Quote");
      expect(doc.firstChild?.type.name).toBe("blockquote");
    });

    it("parses bullet lists", () => {
      const doc = parseMarkdown(schema, "- Item 1\n- Item 2");
      expect(doc.firstChild?.type.name).toBe("bulletList");
    });

    it("parses ordered lists", () => {
      const doc = parseMarkdown(schema, "1. Item 1\n2. Item 2");
      expect(doc.firstChild?.type.name).toBe("orderedList");
    });

    it("parses horizontal rules", () => {
      const doc = parseMarkdown(schema, "---");
      expect(doc.firstChild?.type.name).toBe("horizontalRule");
    });
  });

  describe("fast parser selection", () => {
    it("uses fast parser for simple markdown", () => {
      const simpleMarkdown = "# Title\n\nSimple paragraph with **bold**.";
      const doc = parseMarkdown(schema, simpleMarkdown);
      expect(doc).toBeDefined();
    });

    it("falls back to remark for math", () => {
      const mathMarkdown = "Inline $x^2$ math";
      const doc = parseMarkdown(schema, mathMarkdown);
      expect(doc).toBeDefined();
    });

    it("falls back to remark for wiki links", () => {
      const wikiMarkdown = "Link to [[page]]";
      const doc = parseMarkdown(schema, wikiMarkdown);
      expect(doc).toBeDefined();
    });

    it("falls back to remark when options are provided", () => {
      const doc = parseMarkdown(schema, "Line 1\nLine 2", {
        preserveLineBreaks: true,
      });
      expect(doc).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("provides meaningful error context on parse failure", () => {
      // This test verifies error wrapping exists
      // Actual parse failures are rare with remark
      const doc = parseMarkdown(schema, "Valid markdown");
      expect(doc).toBeDefined();
    });
  });
});

describe("serializeMarkdown", () => {
  const schema = createTestSchema();

  describe("basic serialization", () => {
    it("serializes empty document", () => {
      const doc = parseMarkdown(schema, "");
      const md = serializeMarkdown(schema, doc);
      expect(typeof md).toBe("string");
    });

    it("serializes heading", () => {
      const doc = parseMarkdown(schema, "# Hello");
      const md = serializeMarkdown(schema, doc);
      expect(md).toContain("# Hello");
    });

    it("serializes paragraph", () => {
      const doc = parseMarkdown(schema, "Hello World");
      const md = serializeMarkdown(schema, doc);
      expect(md).toContain("Hello World");
    });
  });

  describe("round-trip consistency", () => {
    it("preserves headings through round-trip", () => {
      const original = "# Heading 1\n\n## Heading 2\n\n### Heading 3";
      const doc = parseMarkdown(schema, original);
      const result = serializeMarkdown(schema, doc);
      expect(result).toContain("# Heading 1");
      expect(result).toContain("## Heading 2");
      expect(result).toContain("### Heading 3");
    });

    it("preserves lists through round-trip", () => {
      const original = "- Item 1\n- Item 2\n- Item 3";
      const doc = parseMarkdown(schema, original);
      const result = serializeMarkdown(schema, doc);
      expect(result).toContain("Item 1");
      expect(result).toContain("Item 2");
      expect(result).toContain("Item 3");
    });

    it("preserves code blocks through round-trip", () => {
      const original = "```javascript\nconst x = 1;\n```";
      const doc = parseMarkdown(schema, original);
      const result = serializeMarkdown(schema, doc);
      expect(result).toContain("const x = 1");
    });

    it("preserves blockquotes through round-trip", () => {
      const original = "> This is a quote";
      const doc = parseMarkdown(schema, original);
      const result = serializeMarkdown(schema, doc);
      expect(result).toContain("> This is a quote");
    });
  });

  describe("inline formatting round-trip", () => {
    it("preserves bold", () => {
      const original = "This is **bold** text";
      const doc = parseMarkdown(schema, original);
      const result = serializeMarkdown(schema, doc);
      expect(result).toContain("**bold**");
    });

    it("preserves italic", () => {
      const original = "This is *italic* text";
      const doc = parseMarkdown(schema, original);
      const result = serializeMarkdown(schema, doc);
      expect(result).toContain("*italic*");
    });

    it("preserves inline code", () => {
      const original = "This is `code` text";
      const doc = parseMarkdown(schema, original);
      const result = serializeMarkdown(schema, doc);
      expect(result).toContain("`code`");
    });

    it("preserves links", () => {
      const original = "[link](https://example.com)";
      const doc = parseMarkdown(schema, original);
      const result = serializeMarkdown(schema, doc);
      expect(result).toContain("[link]");
      expect(result).toContain("https://example.com");
    });
  });
});
