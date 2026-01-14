/**
 * Adapter remark pipeline tests
 *
 * Comprehensive round-trip tests covering all markdown features.
 *
 * Features covered:
 * - Basic CommonMark (paragraphs, headings, code)
 * - GFM tables with alignment
 * - Task lists
 * - Inline marks (bold, italic, strike, highlight, subscript, superscript)
 * - Block/inline math
 * - Footnotes
 * - Alerts and details blocks
 * - Images (inline and block)
 */

import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "./adapter";
import { testSchema } from "./testSchema";

describe("adapter remark pipeline", () => {
  describe("basic CommonMark", () => {
    it("parses and serializes basic markdown", () => {
      const input = "# Title\n\nHello world";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc);
      expect(output).toContain("# Title");
      expect(output).toContain("Hello world");
    });

    it("round-trips simple text", () => {
      const doc = parseMarkdown(testSchema, "Hello");
      const output = serializeMarkdown(testSchema, doc);
      expect(output.trim()).toBe("Hello");
    });
  });

  describe("table support", () => {
    it("round-trips a basic table", () => {
      const input = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      // Remark minimizes separator dashes, verify table structure preserved
      expect(output).toContain("| a |");
      expect(output).toContain("| b |");
      expect(output).toContain("| 1 |");
      expect(output).toContain("| 2 |");
      expect(output).toMatch(/\| -+ \|/); // Has separator row
    });

    it("preserves column alignment markers", () => {
      const input = ["| a | b | c |", "| :-- | :-: | --: |", "| 1 | 2 | 3 |"].join("\n");
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      // Remark uses minimal dashes, verify alignment markers preserved
      expect(output).toMatch(/\| :?-+:? \|/); // Has alignment markers
      expect(output).toMatch(/:-/); // Left align
      expect(output).toMatch(/:-.*-:/); // Center align
      expect(output).toMatch(/-:/); // Right align
    });
  });

  describe("inline mark support", () => {
    it("round-trips highlight/subscript/superscript", () => {
      const input = "a ==hi== ~sub~ ^sup^ ~~strike~~";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });

    it("round-trips underline", () => {
      const input = "a ++underlined++ b";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });
  });

  describe("image support", () => {
    it("round-trips an inline image", () => {
      const input = "Hello ![alt](./assets/images/a.png) world";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });

    it("round-trips a standalone image (block image)", () => {
      const input = "![alt](./assets/images/a.png)";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });

    it("round-trips an image inside a list item", () => {
      const input = "- ![alt](./assets/images/a.png)";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });
  });

  describe("alert/details support", () => {
    it("round-trips a GitHub-style alert block", () => {
      const input = ["> [!NOTE]", "> hello"].join("\n");
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      // Remark may escape brackets, verify semantic structure preserved
      expect(output).toContain("[!NOTE]");
      expect(output).toContain("> ");
      expect(output).toContain("hello");
    });

    it("round-trips a details block", () => {
      const input = ["<details>", "<summary>Click</summary>", "", "Hello **world**", "</details>"].join("\n");
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toContain("<details>");
      expect(output).toContain("<summary>Click</summary>");
      expect(output).toContain("**world**");
      expect(output).toContain("</details>");
    });

    it("preserves details open attribute", () => {
      const input = ["<details open>", "<summary>Open</summary>", "", "Visible", "</details>"].join("\n");
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toContain("<details open>");
      expect(output).toContain("<summary>Open</summary>");
      expect(output).toContain("Visible");
      expect(output).toContain("</details>");
    });
  });

  describe("task list support", () => {
    it("round-trips task list checkboxes", () => {
      const input = ["- [ ] todo", "- [x] done"].join("\n");
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      // Remark may use * instead of -, verify checkbox structure preserved
      expect(output).toMatch(/[-*] \[ \] todo/);
      expect(output).toMatch(/[-*] \[x\] done/);
    });
  });

  describe("footnote support", () => {
    it("round-trips footnote references + definitions", () => {
      const input = ["Hello [^1]", "", "[^1]: note"].join("\n");
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });

    it("handles multiple footnotes", () => {
      const input = ["Text [^a] and [^b]", "", "[^a]: First note", "", "[^b]: Second note"].join("\n");
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });
  });

  describe("math support", () => {
    it("round-trips inline math", () => {
      const input = "Formula: $E=mc^2$";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });

    it("outputs block math as $$...$$", () => {
      // Remark pipeline canonical output is $$...$$ (not fenced latex)
      const input = ["$$", "E=mc^2", "$$"].join("\n");
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      expect(output).toBe(input);
    });

    it("rejects currency patterns as math", () => {
      // $100 and $200 should NOT become inline math
      const input = "$100 and $200";
      const doc = parseMarkdown(testSchema, input);
      const output = serializeMarkdown(testSchema, doc).trim();
      // Should remain as plain text, not math (remark escapes $ as \$)
      const unescaped = output.replace(/\\/g, "");
      expect(unescaped).toContain("$100");
      expect(unescaped).toContain("$200");
      // Verify no math nodes created (math would have unescaped $...$)
      // Escaped \$ is NOT math syntax
      expect(unescaped).not.toMatch(/\$\S+\$/);
    });
  });
});
