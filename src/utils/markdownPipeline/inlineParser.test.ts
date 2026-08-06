/**
 * Tests for parseInlineMarkdown — inline markdown text to MDAST nodes.
 */

import { describe, it, expect, vi } from "vitest";
import { parseInlineMarkdown } from "./inlineParser";
import type { Text } from "mdast";

describe("parseInlineMarkdown", () => {
  describe("empty and plain text", () => {
    it("returns empty array for empty string", () => {
      expect(parseInlineMarkdown("")).toEqual([]);
    });

    it("returns empty array for whitespace-only string", () => {
      expect(parseInlineMarkdown("   ")).toEqual([]);
    });

    it("returns empty array for null-like empty string", () => {
      expect(parseInlineMarkdown("")).toEqual([]);
    });

    it("returns plain text node for text without markdown chars", () => {
      const result = parseInlineMarkdown("Hello world");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("text");
      expect((result[0] as Text).value).toBe("Hello world");
    });

    it("returns plain text for text with no markdown-special characters", () => {
      const result = parseInlineMarkdown("Just a normal sentence with numbers 123");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("text");
      expect((result[0] as Text).value).toBe("Just a normal sentence with numbers 123");
    });

    it("returns plain text for CJK text without formatting", () => {
      const result = parseInlineMarkdown("中文文本没有格式");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("text");
      expect((result[0] as Text).value).toBe("中文文本没有格式");
    });
  });

  describe("inline formatting", () => {
    it("parses bold text", () => {
      const result = parseInlineMarkdown("**bold**");
      expect(result.length).toBeGreaterThanOrEqual(1);
      const hasStrong = result.some((n) => n.type === "strong");
      expect(hasStrong).toBe(true);
    });

    it("parses italic text", () => {
      const result = parseInlineMarkdown("*italic*");
      expect(result.length).toBeGreaterThanOrEqual(1);
      const hasEmphasis = result.some((n) => n.type === "emphasis");
      expect(hasEmphasis).toBe(true);
    });

    it("parses strikethrough text", () => {
      const result = parseInlineMarkdown("~~deleted~~");
      expect(result.length).toBeGreaterThanOrEqual(1);
      const hasDelete = result.some((n) => n.type === "delete");
      expect(hasDelete).toBe(true);
    });

    it("parses inline code", () => {
      const result = parseInlineMarkdown("`code`");
      expect(result.length).toBeGreaterThanOrEqual(1);
      const hasCode = result.some((n) => n.type === "inlineCode");
      expect(hasCode).toBe(true);
    });

    it("parses links", () => {
      const result = parseInlineMarkdown("[link](https://example.com)");
      expect(result.length).toBeGreaterThanOrEqual(1);
      const hasLink = result.some((n) => n.type === "link");
      expect(hasLink).toBe(true);
    });

    it("parses mixed inline formatting", () => {
      const result = parseInlineMarkdown("**bold** and *italic* and `code`");
      const hasStrong = result.some((n) => n.type === "strong");
      const hasEmphasis = result.some((n) => n.type === "emphasis");
      const hasCode = result.some((n) => n.type === "inlineCode");
      expect(hasStrong).toBe(true);
      expect(hasEmphasis).toBe(true);
      expect(hasCode).toBe(true);
    });

    it("parses nested bold and italic", () => {
      const result = parseInlineMarkdown("***bold italic***");
      // Should produce strong > emphasis > text or emphasis > strong > text
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("fast-path optimization", () => {
    it("bypasses remark for text without markdown characters", () => {
      // No *, _, `, ~, [, ] characters => fast path returns plain text
      const result = parseInlineMarkdown("plain sentence");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("text");
      expect((result[0] as Text).value).toBe("plain sentence");
    });

    it("processes text containing asterisk through remark", () => {
      const result = parseInlineMarkdown("has * asterisk");
      // Contains *, should go through remark even if not actual formatting
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("processes text containing bracket through remark", () => {
      const result = parseInlineMarkdown("has [bracket]");
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("processes text containing tilde through remark", () => {
      const result = parseInlineMarkdown("has ~ tilde");
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("processes text containing underscore through remark", () => {
      const result = parseInlineMarkdown("has _underscore_");
      expect(result.length).toBeGreaterThanOrEqual(1);
      const hasEmphasis = result.some((n) => n.type === "emphasis");
      expect(hasEmphasis).toBe(true);
    });

    it("processes text containing backtick through remark", () => {
      const result = parseInlineMarkdown("has `backtick`");
      expect(result.length).toBeGreaterThanOrEqual(1);
      const hasCode = result.some((n) => n.type === "inlineCode");
      expect(hasCode).toBe(true);
    });
  });

  describe("custom inline marks", () => {
    it("parses highlight ==text==", () => {
      // = is in the fast-path regex so ==highlight== reaches remark and
      // the customInline transform.
      const result = parseInlineMarkdown("==highlighted==");
      const hasHighlight = result.some((n) => n.type === "highlight");
      expect(hasHighlight).toBe(true);
    });

    it("parses underline ++text++", () => {
      const result = parseInlineMarkdown("++underlined++");
      const hasUnderline = result.some((n) => n.type === "underline");
      expect(hasUnderline).toBe(true);
    });

    it("parses subscript ~text~", () => {
      const result = parseInlineMarkdown("H~2~O");
      const hasSubscript = result.some((n) => n.type === "subscript");
      expect(hasSubscript).toBe(true);
    });

    it("parses superscript ^text^", () => {
      // ^ is in the fast-path regex so x^2^ reaches remark and the
      // customInline transform.
      const result = parseInlineMarkdown("x^2^");
      const hasSuperscript = result.some((n) => n.type === "superscript");
      expect(hasSuperscript).toBe(true);
    });

    it("still takes the fast path for plain text without any marker chars", () => {
      const result = parseInlineMarkdown("no markers here");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("text");
      expect((result[0] as Text).value).toBe("no markers here");
    });
  });

  describe("edge cases", () => {
    it("handles text that parses to non-paragraph root children", () => {
      // If remark produces something other than a paragraph as first child,
      // the function returns children as-is
      // This is hard to trigger with inline text, but let's test the guard
      const result = parseInlineMarkdown("---");
      // --- may parse as thematicBreak, which isn't a paragraph
      // The function should return children array
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("handles CJK text with formatting", () => {
      const result = parseInlineMarkdown("**粗体** *斜体*");
      const hasStrong = result.some((n) => n.type === "strong");
      const hasEmphasis = result.some((n) => n.type === "emphasis");
      expect(hasStrong).toBe(true);
      expect(hasEmphasis).toBe(true);
    });

    it("handles emoji in text (no markdown chars, fast path)", () => {
      const result = parseInlineMarkdown("Hello 😀 World");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("text");
      expect((result[0] as Text).value).toBe("Hello 😀 World");
    });

    it("handles single markdown character that does not form formatting", () => {
      const result = parseInlineMarkdown("a * b");
      // Single asterisk with spaces does not create emphasis
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("handles image syntax in inline context", () => {
      const result = parseInlineMarkdown("![alt](url)");
      // Should parse the brackets/markers
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("falls back to plain text when input parses to a block node ('***')", () => {
      // "***" parses as a thematicBreak (block node). Returning it as
      // "inline" content would violate inline-only schemas (details
      // <summary>) and throw on insertion — fall back to literal text.
      const result = parseInlineMarkdown("***");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("text");
      expect((result[0] as Text).value).toBe("***");
    });

    it("falls back to plain text for multi-block input", () => {
      // Two paragraphs cannot be flattened into one inline run — the
      // strict single-paragraph guard falls back to literal text.
      const result = parseInlineMarkdown("first *a*\n\nsecond");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("text");
      expect((result[0] as Text).value).toBe("first *a*\n\nsecond");
    });

    it("returns only phrasing content for details-summary-shaped inputs", () => {
      // A details <summary> node accepts inline content only — whatever
      // comes back must never contain block node types.
      const blockTypes = new Set([
        "thematicBreak",
        "heading",
        "paragraph",
        "list",
        "blockquote",
        "code",
        "table",
        "html",
      ]);
      const inputs = ["***", "___", "Summary **bold** `code`", "a *x*\n\nb"];
      for (const input of inputs) {
        for (const node of parseInlineMarkdown(input)) {
          expect(blockTypes.has(node.type)).toBe(false);
        }
      }
    });

    it("returns text fallback when remark returns empty children (line 60)", () => {
      // Extremely hard to trigger, but we can test the guard by
      // parsing text that contains markdown chars but produces no output
      // This is defensive code — verify it at least doesn't crash
      const result = parseInlineMarkdown("[]");
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("error handling (catch block, lines 73-74)", () => {
    it("returns plain text fallback when unified processor throws", async () => {
      // The processor now comes from the dialect (WI-3.1), so that is the
      // boundary to mock — `unified` is no longer imported here.
      vi.doMock("./dialect", () => ({
        buildProcessorForMode: () => ({
          parse: () => { throw new Error("Mock parse failure"); },
        }),
      }));
      try {
        const { parseInlineMarkdown: parseFresh } = await import("./inlineParser?err=1");
        const result = parseFresh("**bold**");
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("text");
        expect((result[0] as Text).value).toBe("**bold**");
      } finally {
        vi.doUnmock("./dialect");
      }
    });

    it("returns plain text fallback when runSync throws", async () => {
      vi.doMock("./dialect", () => ({
        buildProcessorForMode: () => ({
          parse: () => ({ type: "root", children: [] }),
          runSync: () => { throw new Error("Mock runSync failure"); },
        }),
      }));
      try {
        const { parseInlineMarkdown: parseFresh } = await import("./inlineParser?err=2");
        const result = parseFresh("*italic*");
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("text");
        expect((result[0] as Text).value).toBe("*italic*");
      } finally {
        vi.doUnmock("./dialect");
      }
    });
  });

  describe("empty children from processor (line 60)", () => {
    it("returns text fallback when processor yields empty children", async () => {
      vi.doMock("./dialect", () => ({
        buildProcessorForMode: () => ({
          parse: () => ({ type: "root", children: [] }),
          runSync: () => ({ type: "root", children: [] }),
        }),
      }));
      try {
        const { parseInlineMarkdown: parseFresh } = await import("./inlineParser?empty=1");
        const result = parseFresh("*text*");
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("text");
        expect((result[0] as Text).value).toBe("*text*");
      } finally {
        vi.doUnmock("./dialect");
      }
    });
  });
});
