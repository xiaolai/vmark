/**
 * Tests for the remark-based markdown parser.
 *
 * Tests lazy plugin loading and MDAST generation.
 */

import { describe, it, expect } from "vitest";
import { parseMarkdownToMdast } from "../parser";
import type { Root, Heading, Paragraph, Code, Blockquote, List, ListItem } from "mdast";

describe("parseMarkdownToMdast", () => {
  describe("basic parsing", () => {
    it("returns root node", () => {
      const mdast = parseMarkdownToMdast("# Hello");
      expect(mdast.type).toBe("root");
      expect(Array.isArray(mdast.children)).toBe(true);
    });

    it("parses empty string", () => {
      const mdast = parseMarkdownToMdast("");
      expect(mdast.type).toBe("root");
      expect(mdast.children.length).toBe(0);
    });

    it("parses heading", () => {
      const mdast = parseMarkdownToMdast("# Hello World");
      const heading = mdast.children[0] as Heading;
      expect(heading.type).toBe("heading");
      expect(heading.depth).toBe(1);
    });

    it("parses multiple heading levels", () => {
      const mdast = parseMarkdownToMdast("# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6");
      const headings = mdast.children.filter((n) => n.type === "heading") as Heading[];
      expect(headings.length).toBe(6);
      expect(headings.map((h) => h.depth)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("parses paragraph", () => {
      const mdast = parseMarkdownToMdast("Hello World");
      const para = mdast.children[0] as Paragraph;
      expect(para.type).toBe("paragraph");
    });

    it("parses code block", () => {
      const mdast = parseMarkdownToMdast("```javascript\nconst x = 1;\n```");
      const code = mdast.children[0] as Code;
      expect(code.type).toBe("code");
      expect(code.lang).toBe("javascript");
      expect(code.value).toContain("const x = 1");
    });

    it("parses blockquote", () => {
      const mdast = parseMarkdownToMdast("> Quote text");
      const quote = mdast.children[0] as Blockquote;
      expect(quote.type).toBe("blockquote");
    });

    it("parses bullet list", () => {
      const mdast = parseMarkdownToMdast("- Item 1\n- Item 2");
      const list = mdast.children[0] as List;
      expect(list.type).toBe("list");
      expect(list.ordered).toBe(false);
      expect(list.children.length).toBe(2);
    });

    it("parses ordered list", () => {
      const mdast = parseMarkdownToMdast("1. First\n2. Second");
      const list = mdast.children[0] as List;
      expect(list.type).toBe("list");
      expect(list.ordered).toBe(true);
    });

    it("parses thematic break", () => {
      const mdast = parseMarkdownToMdast("---");
      expect(mdast.children[0].type).toBe("thematicBreak");
    });
  });

  describe("GFM features", () => {
    it("parses tables", () => {
      const md = "| A | B |\n|---|---|\n| 1 | 2 |";
      const mdast = parseMarkdownToMdast(md);
      expect(mdast.children[0].type).toBe("table");
    });

    it("parses task lists", () => {
      const md = "- [ ] Todo\n- [x] Done";
      const mdast = parseMarkdownToMdast(md);
      const list = mdast.children[0] as List;
      expect(list.type).toBe("list");
      const items = list.children as ListItem[];
      expect(items[0].checked).toBe(false);
      expect(items[1].checked).toBe(true);
    });

    it("parses strikethrough", () => {
      const md = "~~deleted~~";
      const mdast = parseMarkdownToMdast(md);
      const para = mdast.children[0] as Paragraph;
      expect(para.children.some((n) => n.type === "delete")).toBe(true);
    });

    it("parses autolinks", () => {
      const md = "Visit https://example.com for more";
      const mdast = parseMarkdownToMdast(md);
      const para = mdast.children[0] as Paragraph;
      expect(para.children.some((n) => n.type === "link")).toBe(true);
    });
  });

  describe("lazy plugin loading - math", () => {
    it("parses inline math when $ present", () => {
      const md = "Equation: $x^2$";
      const mdast = parseMarkdownToMdast(md);
      const para = mdast.children[0] as Paragraph;
      expect(para.children.some((n) => n.type === "inlineMath")).toBe(true);
    });

    it("parses block math when $$ present", () => {
      const md = "$$\nE = mc^2\n$$";
      const mdast = parseMarkdownToMdast(md);
      expect(mdast.children.some((n) => n.type === "math")).toBe(true);
    });

    it("validates inline math - content with leading whitespace is reverted to text", () => {
      // The validator converts math with leading/trailing space back to text
      const md = "Result: $ spaced$";
      const mdast = parseMarkdownToMdast(md);
      const para = mdast.children[0] as Paragraph;
      // Math with leading space should be reverted to text
      // Check that at least one child is text containing the dollar sign
      const hasTextWithDollar = para.children.some(
        (n) => n.type === "text" && (n as { value: string }).value.includes("$")
      );
      expect(hasTextWithDollar).toBe(true);
    });

    it("validates inline math - content with trailing whitespace is reverted to text", () => {
      const md = "Result: $spaced $";
      const mdast = parseMarkdownToMdast(md);
      const para = mdast.children[0] as Paragraph;
      // Math with trailing space should be reverted to text
      const hasTextWithDollar = para.children.some(
        (n) => n.type === "text" && (n as { value: string }).value.includes("$")
      );
      expect(hasTextWithDollar).toBe(true);
    });
  });

  describe("lazy plugin loading - frontmatter", () => {
    it("parses YAML frontmatter when document starts with ---", () => {
      const md = "---\ntitle: Test\n---\n\n# Content";
      const mdast = parseMarkdownToMdast(md);
      expect(mdast.children[0].type).toBe("yaml");
    });

    it("does not load frontmatter plugin for normal content", () => {
      const md = "# Title\n\n---\n\nParagraph";
      const mdast = parseMarkdownToMdast(md);
      // --- in middle is thematic break, not frontmatter
      expect(mdast.children[0].type).toBe("heading");
    });
  });

  describe("lazy plugin loading - wiki links", () => {
    it("parses wiki links when [[ present", () => {
      const md = "Link to [[Page Name]]";
      const mdast = parseMarkdownToMdast(md);
      const para = mdast.children[0] as Paragraph;
      expect(para.children.some((n) => n.type === "wikiLink")).toBe(true);
    });

    it("does not load wiki link plugin when not needed", () => {
      const md = "Normal [link](url)";
      const mdast = parseMarkdownToMdast(md);
      const para = mdast.children[0] as Paragraph;
      expect(para.children.some((n) => n.type === "link")).toBe(true);
      expect(para.children.some((n) => n.type === "wikiLink")).toBe(false);
    });
  });

  describe("lazy plugin loading - details", () => {
    it("parses details block when <details present", () => {
      const md = "<details>\n<summary>Click</summary>\nContent\n</details>";
      const mdast = parseMarkdownToMdast(md);
      expect(mdast.children.some((n) => n.type === "details")).toBe(true);
    });
  });

  describe("custom inline syntax", () => {
    it("parses highlight ==text==", () => {
      const md = "This is ==highlighted== text";
      const mdast = parseMarkdownToMdast(md);
      const para = mdast.children[0] as Paragraph;
      expect(para.children.some((n) => n.type === "highlight")).toBe(true);
    });

    it("parses subscript ~text~", () => {
      const md = "H~2~O";
      const mdast = parseMarkdownToMdast(md);
      const para = mdast.children[0] as Paragraph;
      expect(para.children.some((n) => n.type === "subscript")).toBe(true);
    });

    it("parses superscript ^text^", () => {
      const md = "x^2^";
      const mdast = parseMarkdownToMdast(md);
      const para = mdast.children[0] as Paragraph;
      expect(para.children.some((n) => n.type === "superscript")).toBe(true);
    });

    it("parses underline ++text++", () => {
      const md = "This is ++underlined++ text";
      const mdast = parseMarkdownToMdast(md);
      const para = mdast.children[0] as Paragraph;
      expect(para.children.some((n) => n.type === "underline")).toBe(true);
    });
  });

  describe("options", () => {
    it("preserveLineBreaks converts soft breaks to hard breaks", () => {
      const md = "Line 1\nLine 2";

      const withoutOption = parseMarkdownToMdast(md, {});
      const withOption = parseMarkdownToMdast(md, { preserveLineBreaks: true });

      // With option, should have break nodes
      const paraWith = withOption.children[0] as Paragraph;
      const hasBreak = paraWith.children.some((n) => n.type === "break");
      expect(hasBreak).toBe(true);

      // Without option, soft breaks become text
      const paraWithout = withoutOption.children[0] as Paragraph;
      const hasBreakWithout = paraWithout.children.some((n) => n.type === "break");
      expect(hasBreakWithout).toBe(false);
    });
  });

  describe("complex documents", () => {
    it("parses mixed content correctly", () => {
      const md = `# Title

A paragraph with **bold** and *italic*.

- List item 1
- List item 2

\`\`\`javascript
const x = 1;
\`\`\`

> A blockquote

| A | B |
|---|---|
| 1 | 2 |
`;
      const mdast = parseMarkdownToMdast(md);
      const types = mdast.children.map((n) => n.type);

      expect(types).toContain("heading");
      expect(types).toContain("paragraph");
      expect(types).toContain("list");
      expect(types).toContain("code");
      expect(types).toContain("blockquote");
      expect(types).toContain("table");
    });

    it("handles nested structures", () => {
      const md = `> # Heading in quote
>
> - List in quote
> - More items

- Item with **bold**
  - Nested item
    - Deeply nested`;

      const mdast = parseMarkdownToMdast(md);
      expect(mdast.children.length).toBeGreaterThan(0);
    });
  });
});
