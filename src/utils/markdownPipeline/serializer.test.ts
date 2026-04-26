/**
 * Serializer tests for remark-based markdown pipeline
 *
 * Tests serializeMdastToMarkdown function.
 * TDD: Write tests first, then implement.
 */

import { describe, it, expect } from "vitest";
import { parseMarkdownToMdast } from "./parser";
import { serializeMdastToMarkdown } from "./serializer";

describe("serializeMdastToMarkdown", () => {
  describe("round-trip basics", () => {
    it("round-trips a simple paragraph", () => {
      const input = "Hello world";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output.trim()).toBe(input);
    });

    it("round-trips headings", () => {
      const input = "# Heading 1";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output.trim()).toBe(input);
    });

    it("round-trips code fences", () => {
      const input = "```js\nconst x = 1;\n```";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output.trim()).toBe(input);
    });

    it("round-trips blockquotes", () => {
      const input = "> Quote text";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output.trim()).toBe(input);
    });
  });

  describe("GFM round-trip", () => {
    it("round-trips strikethrough", () => {
      const input = "~~deleted~~";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output.trim()).toBe(input);
    });

    it("round-trips tables", () => {
      const input = `| A | B |
| - | - |
| 1 | 2 |`;
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      // Table output may have slight formatting differences
      expect(output).toContain("| A | B |");
      expect(output).toContain("| 1 | 2 |");
    });

    it("round-trips task lists", () => {
      const input = `- [ ] unchecked
- [x] checked`;
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("[ ]");
      expect(output).toContain("[x]");
    });
  });

  describe("frontmatter round-trip", () => {
    it("round-trips YAML frontmatter", () => {
      const input = `---
title: Test
---

Content`;
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("---");
      expect(output).toContain("title: Test");
    });
  });

  describe("math round-trip", () => {
    it("round-trips inline math", () => {
      const input = "Equation: $E = mc^2$";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("$E = mc^2$");
    });

    it("round-trips block math", () => {
      const input = `$$
x^2 + y^2 = z^2
$$`;
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("$$");
      expect(output).toContain("x^2 + y^2 = z^2");
    });
  });

  describe("wiki link round-trip", () => {
    it("round-trips wiki links", () => {
      const input = "See [[Page|Alias]]";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("[[Page|Alias]]");
    });
  });

  describe("details round-trip", () => {
    it("round-trips details blocks", () => {
      const input = "<details>\\n<summary>Info</summary>\\n\\nBody\\n</details>";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("<details");
      expect(output).toContain("<summary>Info</summary>");
      expect(output).toContain("Body");
    });
  });

  describe("custom inline round-trip", () => {
    it("round-trips highlight ==text==", () => {
      const input = "==highlighted==";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output.trim()).toBe(input);
    });

    it("round-trips subscript ~text~", () => {
      const input = "H~2~O";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output.trim()).toBe(input);
    });

    it("round-trips superscript ^text^", () => {
      const input = "x^2^";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output.trim()).toBe(input);
    });

    it("round-trips underline ++text++", () => {
      const input = "++underlined++";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output.trim()).toBe(input);
    });
  });

  describe("hardBreakStyle option", () => {
    it("converts backslash breaks to two-space breaks", () => {
      // Parse content with hard breaks
      const mdast = parseMarkdownToMdast("Line 1\\\nLine 2", { preserveLineBreaks: false });
      const output = serializeMdastToMarkdown(mdast, { hardBreakStyle: "twoSpaces" });
      // Should have two spaces before newline instead of backslash
      expect(output).toContain("  \n");
      expect(output).not.toContain("\\\n");
    });

    it("preserves backslash breaks by default", () => {
      const mdast = parseMarkdownToMdast("Line 1\\\nLine 2");
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("\\\n");
    });
  });

  describe("URL with whitespace", () => {
    it("wraps image URLs with spaces in angle brackets", () => {
      const mdast = parseMarkdownToMdast("![alt](</path/with spaces/img.png>)");
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("</path/with spaces/img.png>");
    });

    it("wraps link URLs with spaces in angle brackets", () => {
      const mdast = parseMarkdownToMdast("[text](</path/with spaces/doc.md>)");
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("</path/with spaces/doc.md>");
    });

    it("does not wrap URLs without spaces", () => {
      const mdast = parseMarkdownToMdast("[text](https://example.com)");
      const output = serializeMdastToMarkdown(mdast);
      expect(output).not.toContain("<https://example.com>");
      expect(output).toContain("(https://example.com)");
    });

    it("handles image with title and spaces in URL", () => {
      const mdast = parseMarkdownToMdast('![alt](</path/with spaces/img.png> "title")');
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("title");
    });

    it("handles link with title and spaces in URL", () => {
      const mdast = parseMarkdownToMdast('[text](</path/with spaces/doc.md> "title")');
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("title");
    });
  });

  describe("entity replacement", () => {
    it("replaces &#x20; entities back to spaces", () => {
      // This tests the post-processing step
      const mdast = parseMarkdownToMdast("Hello world");
      const output = serializeMdastToMarkdown(mdast);
      expect(output).not.toContain("&#x20;");
    });
  });

  describe("list formatting", () => {
    it("uses dash for bullet lists", () => {
      const mdast = parseMarkdownToMdast("- item 1\n- item 2");
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("- item 1");
      expect(output).toContain("- item 2");
    });

    it("uses dot for ordered lists", () => {
      const mdast = parseMarkdownToMdast("1. first\n2. second");
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("1.");
      expect(output).toContain("2.");
    });
  });

  describe("CJK round-trip", () => {
    it("round-trips CJK text", () => {
      const input = "中文文本 **粗体** *斜体*";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output).toContain("中文文本");
      expect(output).toContain("**粗体**");
      expect(output).toContain("*斜体*");
    });
  });

  describe("unnecessary escape stripping", () => {
    it("does not escape dollar signs in plain text", () => {
      const input = "Price is $100";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe(input);
    });

    it("does not escape square brackets in plain text", () => {
      const input = "Use [brackets] here";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe(input);
    });

    it("does not escape lone asterisks", () => {
      const input = "Use * star";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe(input);
    });

    it("does not escape lone underscores", () => {
      const input = "Use _ underscore";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe(input);
    });

    it("does not escape lone backticks", () => {
      const input = "Use ` backtick";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe(input);
    });

    it("preserves real emphasis markup", () => {
      const input = "**bold** and *italic*";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe(input);
    });

    it("preserves real links", () => {
      const input = "[link](https://example.com)";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe(input);
    });

    it("preserves inline math with dollar signs", () => {
      const input = "Equation: $E = mc^2$";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe(input);
    });

    it("handles CJK text with dollar signs", () => {
      const input = "CJK $100 价格";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe(input);
    });

    it("handles CJK text with square brackets", () => {
      const input = "CJK [注释] test";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe(input);
    });

    it("handles inline code (backticks are structural, not escaped)", () => {
      const input = "a `backtick` here";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe(input);
    });

    it("handles pipes in plain text", () => {
      const input = "a | b | c";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe(input);
    });

    it("preserves escape for * at start of line (would create list)", () => {
      // Input with escaped * at line start — parser creates plain text node
      const input = "\\* not a list";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      // Must keep escape to avoid creating an unordered list marker
      expect(output).toBe("\\* not a list");
    });

    it("strips * escape mid-line but preserves at start", () => {
      const input = "text \\* more";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      // Mid-line * should be unescaped
      expect(output).toBe("text * more");
    });

    it("does not escape parentheses in plain text", () => {
      // remark-stringify defensively escapes `(` near link-like tokens.
      // SAFE_UNESCAPE_RE must strip these so source view shows clean text.
      const input = "Use (parens) here";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe(input);
    });

    it("strips spurious escapes from plain text resembling a link with code", () => {
      // Regression for scenario 3: when a paste falls through as plain text,
      // remark-stringify defensively escapes `[`, `` ` ``, `]`, `(`, `)`.
      // After SAFE_UNESCAPE_RE plus escape-aware buildCodeRanges, the output
      // must equal the original text — no stray `\(` or trapped `\``.
      const mdast = {
        type: "root" as const,
        children: [
          {
            type: "paragraph" as const,
            children: [
              {
                type: "text" as const,
                value: "ISC License. See [`LICENSE`](./LICENSE).",
              },
            ],
          },
        ],
      };
      const output = serializeMdastToMarkdown(mdast).trim();
      expect(output).toBe("ISC License. See [`LICENSE`](./LICENSE).");
    });
  });

  describe("nested structures round-trip", () => {
    it("round-trips blockquote with paragraph", () => {
      const input = "> quoted text";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output.trim()).toBe(input);
    });

    it("round-trips horizontal rules", () => {
      const input = "---";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      expect(output.trim()).toBe(input);
    });
  });

  describe("code range lookup (O(log N) binary search)", () => {
    it("preserves escapes inside many inline code spans", () => {
      // Document with many inline code spans interleaved with text containing
      // characters that would normally be unescaped. Exercises the merged-range
      // binary search against the old O(N·M) Array.some() lookup.
      const segments: string[] = [];
      for (let i = 0; i < 200; i++) {
        segments.push(`Text ${i} with \\* star and \`code_${i}\` span.`);
      }
      const input = segments.join("\n\n");
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);

      // Every inline code span must survive (inside code, nothing is unescaped).
      for (let i = 0; i < 200; i++) {
        expect(output).toContain(`\`code_${i}\``);
      }
      // Mid-line \* is safe to unescape outside code.
      expect(output).toContain("with * star");
      expect(output).not.toContain("with \\* star");
    });

    it("handles hardBreakStyle=twoSpaces on post-strip string", () => {
      // Regression: buildCodeRanges must be rebuilt after stripUnnecessaryEscapes
      // because position offsets shift. An earlier refactor reused stale ranges
      // and produced wrong hard-break replacements near stripped escapes.
      const input = "line one\\\nline two \\* marker\\\nline three";
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast, { hardBreakStyle: "twoSpaces" });
      // Hard break `\\\n` should become "  \n".
      expect(output).toContain("  \n");
      // And the mid-line \* should still be unescaped.
      expect(output).toContain("* marker");
    });

    it("does not unescape inside fenced code blocks with unusual content", () => {
      const input = [
        "text with \\* mid-line",
        "",
        "```",
        "code line with \\[ and \\* and \\_",
        "```",
        "",
        "more text with \\[bracket",
      ].join("\n");
      const mdast = parseMarkdownToMdast(input);
      const output = serializeMdastToMarkdown(mdast);
      // Inside fence — escapes preserved.
      expect(output).toContain("code line with \\[ and \\* and \\_");
      // Outside fence — escapes stripped.
      expect(output).toContain("text with * mid-line");
      expect(output).toContain("more text with [bracket");
    });
  });
});
