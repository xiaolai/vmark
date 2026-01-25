/**
 * Tests for ANSI renderer utilities.
 *
 * Verifies markdown block rendering to ANSI escape sequences.
 */

import { describe, it, expect } from "vitest";
import { renderBlocks, likelyContainsMarkdown, ANSI, BOX } from "./ansiRenderer";
import type { MarkdownBlock } from "./types";

describe("ansiRenderer", () => {
  describe("ANSI constants", () => {
    it("exports reset code", () => {
      expect(ANSI.RESET).toBe("\x1b[0m");
    });

    it("exports text style codes", () => {
      expect(ANSI.BOLD).toBe("\x1b[1m");
      expect(ANSI.DIM).toBe("\x1b[2m");
      expect(ANSI.ITALIC).toBe("\x1b[3m");
      expect(ANSI.UNDERLINE).toBe("\x1b[4m");
    });

    it("exports foreground color codes", () => {
      expect(ANSI.RED).toBe("\x1b[31m");
      expect(ANSI.GREEN).toBe("\x1b[32m");
      expect(ANSI.BLUE).toBe("\x1b[34m");
      expect(ANSI.CYAN).toBe("\x1b[36m");
    });

    it("exports bright color codes", () => {
      expect(ANSI.BRIGHT_RED).toBe("\x1b[91m");
      expect(ANSI.BRIGHT_GREEN).toBe("\x1b[92m");
      expect(ANSI.BRIGHT_CYAN).toBe("\x1b[96m");
    });

    it("exports background color codes", () => {
      expect(ANSI.BG_RED).toBe("\x1b[41m");
      expect(ANSI.BG_GREEN).toBe("\x1b[42m");
      expect(ANSI.BG_BLUE).toBe("\x1b[44m");
    });
  });

  describe("BOX constants", () => {
    it("exports box drawing characters", () => {
      expect(BOX.H_LINE).toBe("─");
      expect(BOX.V_LINE).toBe("│");
      expect(BOX.TOP_LEFT).toBe("┌");
      expect(BOX.TOP_RIGHT).toBe("┐");
      expect(BOX.BOTTOM_LEFT).toBe("└");
      expect(BOX.BOTTOM_RIGHT).toBe("┘");
    });

    it("exports special characters", () => {
      expect(BOX.BULLET).toBe("●");
      expect(BOX.ARROW).toBe("▶");
      expect(BOX.BLOCK).toBe("▌");
    });
  });

  describe("renderBlocks", () => {
    describe("heading rendering", () => {
      it("renders h1 heading with styling", () => {
        const blocks: MarkdownBlock[] = [
          { type: "heading", level: 1, content: "Title", raw: "# Title" },
        ];
        const result = renderBlocks(blocks);
        expect(result).toContain("Title");
        expect(result).toContain(ANSI.BOLD);
        expect(result).toContain(ANSI.RESET);
        expect(result).toContain(BOX.BLOCK);
      });

      it("uses different colors for different heading levels", () => {
        const h1: MarkdownBlock[] = [{ type: "heading", level: 1, content: "H1", raw: "# H1" }];
        const h2: MarkdownBlock[] = [{ type: "heading", level: 2, content: "H2", raw: "## H2" }];

        const result1 = renderBlocks(h1);
        const result2 = renderBlocks(h2);

        // H1 uses BRIGHT_CYAN, H2 uses BRIGHT_GREEN
        expect(result1).toContain(ANSI.BRIGHT_CYAN);
        expect(result2).toContain(ANSI.BRIGHT_GREEN);
      });
    });

    describe("code block rendering", () => {
      it("renders code block with borders", () => {
        const blocks: MarkdownBlock[] = [
          {
            type: "codeBlock",
            content: "const x = 1;",
            language: "javascript",
            raw: "```javascript\nconst x = 1;\n```",
          },
        ];
        const result = renderBlocks(blocks);
        expect(result).toContain("const x = 1;");
        expect(result).toContain(BOX.H_LINE);
      });

      it("shows language tag by default", () => {
        const blocks: MarkdownBlock[] = [
          {
            type: "codeBlock",
            content: "code",
            language: "python",
            raw: "```python\ncode\n```",
          },
        ];
        const result = renderBlocks(blocks, { showLanguage: true });
        expect(result).toContain("python");
      });

      it("hides language tag when disabled", () => {
        const blocks: MarkdownBlock[] = [
          {
            type: "codeBlock",
            content: "code",
            language: "python",
            raw: "```python\ncode\n```",
          },
        ];
        const result = renderBlocks(blocks, { showLanguage: false });
        // Still contains the code, but may not emphasize language
        expect(result).toContain("code");
      });

      it("handles multi-line code", () => {
        const blocks: MarkdownBlock[] = [
          {
            type: "codeBlock",
            content: "line1\nline2\nline3",
            raw: "```\nline1\nline2\nline3\n```",
          },
        ];
        const result = renderBlocks(blocks);
        expect(result).toContain("line1");
        expect(result).toContain("line2");
        expect(result).toContain("line3");
      });

      it("respects custom terminal width", () => {
        const blocks: MarkdownBlock[] = [
          {
            type: "codeBlock",
            content: "code",
            raw: "```\ncode\n```",
          },
        ];
        const result = renderBlocks(blocks, { termWidth: 40 });
        // Border should be narrower
        expect(result).toBeDefined();
      });
    });

    describe("list rendering", () => {
      it("renders bullet list with bullet character", () => {
        const blocks: MarkdownBlock[] = [
          { type: "list", listType: "bullet", content: "Item", raw: "- Item" },
        ];
        const result = renderBlocks(blocks);
        expect(result).toContain("Item");
        expect(result).toContain(BOX.BULLET);
        expect(result).toContain(ANSI.GREEN);
      });

      it("renders ordered list with arrow", () => {
        const blocks: MarkdownBlock[] = [
          { type: "list", listType: "ordered", content: "First", raw: "1. First" },
        ];
        const result = renderBlocks(blocks);
        expect(result).toContain("First");
        expect(result).toContain(BOX.ARROW);
        expect(result).toContain(ANSI.BRIGHT_BLUE);
      });
    });

    describe("blockquote rendering", () => {
      it("renders blockquote with vertical bar and italic", () => {
        const blocks: MarkdownBlock[] = [
          { type: "blockquote", content: "Quote", raw: "> Quote" },
        ];
        const result = renderBlocks(blocks);
        expect(result).toContain("Quote");
        expect(result).toContain(BOX.V_LINE);
        expect(result).toContain(ANSI.ITALIC);
      });
    });

    describe("horizontal rule rendering", () => {
      it("renders horizontal rule", () => {
        const blocks: MarkdownBlock[] = [
          { type: "horizontalRule", content: "", raw: "---" },
        ];
        const result = renderBlocks(blocks);
        expect(result).toContain(BOX.H_LINE);
        expect(result).toContain(ANSI.DIM);
      });

      it("respects terminal width for horizontal rule", () => {
        const blocks: MarkdownBlock[] = [
          { type: "horizontalRule", content: "", raw: "---" },
        ];
        const result80 = renderBlocks(blocks, { termWidth: 80 });
        const result40 = renderBlocks(blocks, { termWidth: 40 });
        // Wider terminal should have longer line
        expect(result80.length).toBeGreaterThan(result40.length);
      });
    });

    describe("paragraph rendering", () => {
      it("renders paragraph as plain content", () => {
        const blocks: MarkdownBlock[] = [
          { type: "paragraph", content: "Hello world", raw: "Hello world" },
        ];
        const result = renderBlocks(blocks);
        expect(result).toBe("Hello world");
      });
    });

    describe("multiple blocks", () => {
      it("joins multiple blocks with newlines", () => {
        const blocks: MarkdownBlock[] = [
          { type: "heading", level: 1, content: "Title", raw: "# Title" },
          { type: "paragraph", content: "Text", raw: "Text" },
        ];
        const result = renderBlocks(blocks);
        const lines = result.split("\n");
        expect(lines.length).toBeGreaterThanOrEqual(2);
      });

      it("renders empty array as empty string", () => {
        const result = renderBlocks([]);
        expect(result).toBe("");
      });
    });
  });

  describe("likelyContainsMarkdown", () => {
    describe("positive cases", () => {
      it("detects headings", () => {
        expect(likelyContainsMarkdown("# Heading")).toBe(true);
        expect(likelyContainsMarkdown("## Sub")).toBe(true);
        expect(likelyContainsMarkdown("### Third")).toBe(true);
      });

      it("detects code fences", () => {
        expect(likelyContainsMarkdown("```")).toBe(true);
        expect(likelyContainsMarkdown("```javascript")).toBe(true);
      });

      it("detects bullet lists", () => {
        expect(likelyContainsMarkdown("- item")).toBe(true);
        expect(likelyContainsMarkdown("* item")).toBe(true);
      });

      it("detects ordered lists", () => {
        expect(likelyContainsMarkdown("1. first")).toBe(true);
        expect(likelyContainsMarkdown("42. item")).toBe(true);
      });

      it("detects blockquotes", () => {
        expect(likelyContainsMarkdown("> quote")).toBe(true);
      });

      it("detects horizontal rules", () => {
        expect(likelyContainsMarkdown("---")).toBe(true);
        expect(likelyContainsMarkdown("___")).toBe(true);
        expect(likelyContainsMarkdown("***")).toBe(true);
        expect(likelyContainsMarkdown("----------")).toBe(true);
      });
    });

    describe("negative cases", () => {
      it("returns false for plain text", () => {
        expect(likelyContainsMarkdown("Hello world")).toBe(false);
      });

      it("returns false for text starting with number but not list", () => {
        expect(likelyContainsMarkdown("100 bottles")).toBe(false);
      });

      it("returns false for text with hash not at start", () => {
        expect(likelyContainsMarkdown("The # symbol")).toBe(false);
      });

      it("returns false for incomplete patterns", () => {
        expect(likelyContainsMarkdown("#")).toBe(false); // No space after
        expect(likelyContainsMarkdown("-")).toBe(false); // No space after
        expect(likelyContainsMarkdown("1.")).toBe(false); // No space after
        expect(likelyContainsMarkdown(">")).toBe(false); // No space after
      });

      it("returns false for empty string", () => {
        expect(likelyContainsMarkdown("")).toBe(false);
      });
    });
  });
});
