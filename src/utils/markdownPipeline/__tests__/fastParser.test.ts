/**
 * Benchmark comparing fast parser (markdown-it) vs remark.
 *
 * Run with: pnpm test -- --run fastParser.bench
 */

import { describe, it, expect } from "vitest";
import { parseMarkdownToMdast } from "../parser";
import { parseMarkdownToMdastFast, canUseFastParser } from "../fastParser";

/**
 * Generate a large markdown document for benchmarking.
 */
function generateBenchmarkMarkdown(lineCount: number): string {
  const lines: string[] = [];
  let currentLine = 0;

  while (currentLine < lineCount) {
    const section = currentLine % 100;

    if (section === 0) {
      lines.push(`# Section ${Math.floor(currentLine / 100) + 1}`);
      lines.push("");
      currentLine += 2;
    } else if (section < 20) {
      lines.push(
        `This is paragraph ${currentLine}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`
      );
      lines.push("");
      currentLine += 2;
    } else if (section < 40) {
      lines.push(`- List item ${currentLine}`);
      currentLine += 1;
    } else if (section < 50) {
      lines.push(`1. Numbered item ${currentLine}`);
      currentLine += 1;
    } else if (section < 60) {
      if (section === 50) {
        lines.push("```javascript");
        lines.push(`function example${currentLine}() {`);
        lines.push(`  console.log("Line ${currentLine}");`);
        lines.push("}");
        lines.push("```");
        lines.push("");
        currentLine += 6;
      } else {
        lines.push(`const x${currentLine} = ${currentLine};`);
        currentLine += 1;
      }
    } else if (section < 70) {
      lines.push(`> Quote line ${currentLine}`);
      currentLine += 1;
    } else if (section < 85) {
      lines.push(
        `**Bold text** and *italic text* and \`inline code\` on line ${currentLine}.`
      );
      lines.push("");
      currentLine += 2;
    } else {
      lines.push(
        `[Link ${currentLine}](https://example.com/${currentLine}) and more text here.`
      );
      lines.push("");
      currentLine += 2;
    }
  }

  return lines.join("\n");
}

describe("Fast Parser Benchmark", () => {
  describe("correctness", () => {
    it("produces similar structure to remark for simple markdown", () => {
      const markdown = `# Hello World

This is a paragraph with **bold** and *italic* text.

- Item 1
- Item 2
- Item 3

\`\`\`javascript
const x = 1;
\`\`\`

> A blockquote

[Link](https://example.com)
`;

      const remarkResult = parseMarkdownToMdast(markdown);
      const fastResult = parseMarkdownToMdastFast(markdown);

      // Both should have same number of top-level children
      expect(fastResult.type).toBe("root");
      expect(fastResult.children.length).toBe(remarkResult.children.length);

      // Check heading
      expect(fastResult.children[0].type).toBe("heading");

      // Check paragraph
      expect(fastResult.children[1].type).toBe("paragraph");

      // Check list
      expect(fastResult.children[2].type).toBe("list");

      // Check code block
      expect(fastResult.children[3].type).toBe("code");

      // Check blockquote
      expect(fastResult.children[4].type).toBe("blockquote");
    });

    it("handles tables correctly", () => {
      const markdown = `| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |
| Cell 3 | Cell 4 |
`;

      const fastResult = parseMarkdownToMdastFast(markdown);

      expect(fastResult.children[0].type).toBe("table");
      const table = fastResult.children[0] as { children: unknown[] };
      expect(table.children.length).toBe(3); // header + 2 rows
    });
  });

  describe("canUseFastParser", () => {
    it("returns true for standard markdown", () => {
      expect(canUseFastParser("# Hello\n\nWorld")).toBe(true);
      expect(canUseFastParser("**bold** and *italic*")).toBe(true);
      expect(canUseFastParser("- list\n- items")).toBe(true);
      expect(canUseFastParser("`inline code` and ```\nblock\n```")).toBe(true);
    });

    it("returns false for math", () => {
      expect(canUseFastParser("Inline $x^2$ math")).toBe(false);
      expect(canUseFastParser("Block $$E=mc^2$$ math")).toBe(false);
    });

    it("returns false for wiki links", () => {
      expect(canUseFastParser("Link to [[page]]")).toBe(false);
    });

    it("returns false for custom inline syntax", () => {
      expect(canUseFastParser("==highlighted==")).toBe(false);
      expect(canUseFastParser("++underlined++")).toBe(false);
      expect(canUseFastParser("~subscript~")).toBe(false);
      expect(canUseFastParser("^superscript^")).toBe(false);
    });

    it("returns false for GFM features with different handling", () => {
      // Task lists
      expect(canUseFastParser("- [ ] todo item")).toBe(false);
      expect(canUseFastParser("- [x] done item")).toBe(false);
      // Tables
      expect(canUseFastParser("| a | b |\n| - | - |\n| 1 | 2 |")).toBe(false);
      // Strikethrough
      expect(canUseFastParser("~~deleted~~")).toBe(false);
    });

    it("returns false for hard breaks", () => {
      expect(canUseFastParser("line one  \nline two")).toBe(false);
    });

    it("returns false for frontmatter", () => {
      expect(canUseFastParser("---\ntitle: test\n---\n\n# Hello")).toBe(false);
    });
  });

  describe("performance comparison", () => {
    const sizes = [1000, 2000, 5000, 10000];

    for (const size of sizes) {
      it(`benchmark ${size} lines`, () => {
        const markdown = generateBenchmarkMarkdown(size);

        // Warm up
        parseMarkdownToMdast(markdown);
        parseMarkdownToMdastFast(markdown);

        // Benchmark remark
        const remarkStart = performance.now();
        const remarkIterations = 3;
        for (let i = 0; i < remarkIterations; i++) {
          parseMarkdownToMdast(markdown);
        }
        const remarkTime = (performance.now() - remarkStart) / remarkIterations;

        // Benchmark fast parser
        const fastStart = performance.now();
        const fastIterations = 10;
        for (let i = 0; i < fastIterations; i++) {
          parseMarkdownToMdastFast(markdown);
        }
        const fastTime = (performance.now() - fastStart) / fastIterations;

        const speedup = remarkTime / fastTime;

        console.log(
          `[Bench] ${size} lines: remark=${remarkTime.toFixed(1)}ms, fast=${fastTime.toFixed(1)}ms, speedup=${speedup.toFixed(1)}x`
        );

        // Fast parser should be at least 5x faster
        expect(speedup).toBeGreaterThan(5);
      });
    }
  });
});
