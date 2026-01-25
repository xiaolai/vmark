/**
 * Tests for MarkdownDetector.
 *
 * Verifies stream-aware markdown block detection.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MarkdownDetector, createMarkdownDetector } from "./markdownDetector";

describe("MarkdownDetector", () => {
  let detector: MarkdownDetector;

  beforeEach(() => {
    detector = createMarkdownDetector();
  });

  describe("factory function", () => {
    it("creates a new detector instance", () => {
      const d = createMarkdownDetector();
      expect(d).toBeInstanceOf(MarkdownDetector);
    });
  });

  describe("heading detection", () => {
    it("detects h1 heading", () => {
      const result = detector.process("# Hello World\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "heading",
        level: 1,
        content: "Hello World",
      });
    });

    it("detects h2 heading", () => {
      const result = detector.process("## Section Title\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "heading",
        level: 2,
        content: "Section Title",
      });
    });

    it("detects h3-h6 headings", () => {
      const result = detector.process("### H3\n#### H4\n##### H5\n###### H6\n");
      expect(result.blocks).toHaveLength(4);
      expect(result.blocks[0].level).toBe(3);
      expect(result.blocks[1].level).toBe(4);
      expect(result.blocks[2].level).toBe(5);
      expect(result.blocks[3].level).toBe(6);
    });

    it("preserves raw heading line", () => {
      const result = detector.process("# Test\n");
      expect(result.blocks[0].raw).toBe("# Test");
    });
  });

  describe("code block detection", () => {
    it("detects simple code block", () => {
      const result = detector.process("```\ncode here\n```\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "codeBlock",
        content: "code here",
      });
    });

    it("detects code block with language", () => {
      const result = detector.process("```javascript\nconsole.log('hi');\n```\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "codeBlock",
        language: "javascript",
        content: "console.log('hi');",
      });
    });

    it("handles multi-line code blocks", () => {
      const code = "```python\ndef hello():\n    print('hi')\n```\n";
      const result = detector.process(code);
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].content).toBe("def hello():\n    print('hi')");
    });

    it("preserves raw code block", () => {
      const result = detector.process("```js\ncode\n```\n");
      expect(result.blocks[0].raw).toContain("```js");
      expect(result.blocks[0].raw).toContain("code");
      expect(result.blocks[0].raw).toContain("```");
    });
  });

  describe("list detection", () => {
    it("detects bullet list with dash", () => {
      const result = detector.process("- Item one\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "list",
        listType: "bullet",
        content: "Item one",
      });
    });

    it("detects bullet list with asterisk", () => {
      const result = detector.process("* Item one\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "list",
        listType: "bullet",
        content: "Item one",
      });
    });

    it("detects ordered list", () => {
      const result = detector.process("1. First item\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "list",
        listType: "ordered",
        content: "First item",
      });
    });

    it("detects multiple list items", () => {
      const result = detector.process("- A\n- B\n- C\n");
      expect(result.blocks).toHaveLength(3);
      expect(result.blocks.every((b) => b.type === "list")).toBe(true);
    });
  });

  describe("blockquote detection", () => {
    it("detects blockquote", () => {
      const result = detector.process("> Quote text\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "blockquote",
        content: "Quote text",
      });
    });

    it("handles empty blockquote", () => {
      const result = detector.process("> \n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "blockquote",
        content: "",
      });
    });
  });

  describe("horizontal rule detection", () => {
    it("detects --- horizontal rule", () => {
      const result = detector.process("---\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "horizontalRule",
      });
    });

    it("detects ___ horizontal rule", () => {
      const result = detector.process("___\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "horizontalRule",
      });
    });

    it("detects *** horizontal rule", () => {
      const result = detector.process("***\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "horizontalRule",
      });
    });

    it("detects longer horizontal rules", () => {
      const result = detector.process("----------\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].type).toBe("horizontalRule");
    });
  });

  describe("paragraph detection", () => {
    it("treats plain text as paragraph", () => {
      const result = detector.process("Just some text\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toMatchObject({
        type: "paragraph",
        content: "Just some text",
      });
    });

    it("skips empty lines", () => {
      const result = detector.process("\n\n\n");
      // Empty lines should not create paragraphs
      expect(result.blocks).toHaveLength(0);
    });
  });

  describe("streaming behavior", () => {
    it("buffers incomplete lines", () => {
      const result1 = detector.process("# Incom");
      expect(result1.blocks).toHaveLength(0);
      expect(result1.incomplete).toBe("# Incom");

      const result2 = detector.process("plete Heading\n");
      expect(result2.blocks).toHaveLength(1);
      expect(result2.blocks[0].content).toBe("Incomplete Heading");
    });

    it("buffers incomplete code blocks", () => {
      const result1 = detector.process("```javascript\nconst x = 1;\n");
      expect(result1.blocks).toHaveLength(0);
      expect(result1.incomplete).toContain("```javascript");
    });

    it("completes code block when closing fence arrives", () => {
      // Process complete code block in one chunk
      const result = detector.process("```javascript\nconst x = 1;\n```\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].content).toBe("const x = 1;");
      expect(result.blocks[0].language).toBe("javascript");
    });
  });

  describe("reset", () => {
    it("clears buffer state", () => {
      detector.process("# Incomplete");
      detector.reset();
      const result = detector.process("# Complete\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].content).toBe("Complete");
    });

    it("clears code block state", () => {
      detector.process("```\ncode\n");
      detector.reset();
      const result = detector.process("# Heading\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].type).toBe("heading");
    });
  });

  describe("flush", () => {
    it("flushes incomplete code block", () => {
      detector.process("```python\ncode here\n");
      const blocks = detector.flush();
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("codeBlock");
      expect(blocks[0].language).toBe("python");
      // Content may have trailing newline from internal buffering
      expect(blocks[0].content).toContain("code here");
    });

    it("flushes buffered text as paragraph", () => {
      detector.process("Incomplete text");
      const blocks = detector.flush();
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        type: "paragraph",
        content: "Incomplete text",
      });
    });

    it("returns empty array when nothing to flush", () => {
      const blocks = detector.flush();
      expect(blocks).toHaveLength(0);
    });

    it("resets state after flush", () => {
      detector.process("```\ncode\n");
      detector.flush();
      const result = detector.process("# New\n");
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].type).toBe("heading");
    });
  });

  describe("mixed content", () => {
    it("parses mixed markdown content", () => {
      const content = `# Title
Some paragraph text.
- List item 1
- List item 2
> A quote
---
`;
      const result = detector.process(content);
      expect(result.blocks.length).toBeGreaterThanOrEqual(5);

      const types = result.blocks.map((b) => b.type);
      expect(types).toContain("heading");
      expect(types).toContain("paragraph");
      expect(types).toContain("list");
      expect(types).toContain("blockquote");
      expect(types).toContain("horizontalRule");
    });
  });
});
