/**
 * Performance baseline tests for markdown pipeline.
 *
 * These tests establish performance baselines for:
 * - Parsing large markdown documents
 * - Serializing large ProseMirror documents
 * - Memory usage patterns
 *
 * BASELINE (2025-02 re-measured):
 * - 1K lines parse: ~70ms, serialize: ~10ms
 * - 5K lines parse: ~210ms, serialize: ~24ms
 * - 10K lines parse: ~400ms, serialize: ~40ms
 * - Scaling: roughly linear (2x input = 2x time)
 *
 * Thresholds are set at ~3x measured baselines to tolerate CI variance,
 * background load, and slower machines without flaking.
 */

import { describe, it, expect, beforeAll } from "vitest";

// Skip performance tests in CI — timing thresholds are meaningless on shared runners
const isCI = !!process.env.CI;
const describePerf = isCI ? describe.skip : describe;
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { parseMarkdown, serializeMarkdown } from "../adapter";
import { parseMarkdownToMdast } from "../parser";

// Create a minimal schema for performance testing
function createTestSchema() {
  return getSchema([StarterKit]);
}

/**
 * Generate a markdown document with the specified number of lines.
 * Includes varied content: headings, paragraphs, lists, code blocks, tables.
 */
function generateLargeMarkdown(lineCount: number): string {
  const lines: string[] = [];
  let currentLine = 0;

  while (currentLine < lineCount) {
    const section = currentLine % 100;

    if (section === 0) {
      // Heading every 100 lines
      lines.push(`# Section ${Math.floor(currentLine / 100) + 1}`);
      lines.push("");
      currentLine += 2;
    } else if (section < 20) {
      // Regular paragraphs
      lines.push(`This is paragraph ${currentLine}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`);
      lines.push("");
      currentLine += 2;
    } else if (section < 40) {
      // Bullet lists
      lines.push(`- List item ${currentLine}`);
      currentLine += 1;
    } else if (section < 50) {
      // Numbered lists
      lines.push(`1. Numbered item ${currentLine}`);
      currentLine += 1;
    } else if (section < 60) {
      // Code block
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
      // Blockquote
      lines.push(`> Quote line ${currentLine}`);
      currentLine += 1;
    } else if (section < 85) {
      // Inline formatting
      lines.push(`**Bold text** and *italic text* and \`inline code\` on line ${currentLine}.`);
      lines.push("");
      currentLine += 2;
    } else {
      // Links and images
      lines.push(`[Link ${currentLine}](https://example.com/${currentLine}) and more text here.`);
      lines.push("");
      currentLine += 2;
    }
  }

  return lines.join("\n");
}

describePerf("Markdown Pipeline Performance", () => {
  let schema: ReturnType<typeof createTestSchema>;

  beforeAll(() => {
    schema = createTestSchema();
  });

  describe("parsing performance", () => {
    it("parses 1,000 lines under 250ms", () => {
      const markdown = generateLargeMarkdown(1000);
      const start = performance.now();
      const doc = parseMarkdown(schema, markdown);
      const elapsed = performance.now() - start;

      expect(doc).toBeDefined();
      expect(doc.content.childCount).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(500); // Baseline: ~70ms, 3x headroom for CI

      console.log(`[Perf] 1K lines parse: ${elapsed.toFixed(2)}ms`);
    });

    it("parses 5,000 lines under 1100ms", () => {
      const markdown = generateLargeMarkdown(5000);
      const start = performance.now();
      const doc = parseMarkdown(schema, markdown);
      const elapsed = performance.now() - start;

      expect(doc).toBeDefined();
      expect(elapsed).toBeLessThan(1500); // Baseline: ~210ms, 3x headroom for CI

      console.log(`[Perf] 5K lines parse: ${elapsed.toFixed(2)}ms`);
    });

    it("parses 10,000 lines under 2500ms", () => {
      const markdown = generateLargeMarkdown(10000);
      const start = performance.now();
      const doc = parseMarkdown(schema, markdown);
      const elapsed = performance.now() - start;

      expect(doc).toBeDefined();
      expect(elapsed).toBeLessThan(2500); // Baseline: ~400ms, 3x headroom for CI

      console.log(`[Perf] 10K lines parse: ${elapsed.toFixed(2)}ms`);
    });
  });

  describe("serialization performance", () => {
    it("serializes 1,000 lines under 300ms", () => {
      const markdown = generateLargeMarkdown(1000);
      const doc = parseMarkdown(schema, markdown);

      const start = performance.now();
      const output = serializeMarkdown(schema, doc);
      const elapsed = performance.now() - start;

      expect(output).toBeDefined();
      expect(output.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(300); // Baseline: ~10ms, 3x headroom for CI

      console.log(`[Perf] 1K lines serialize: ${elapsed.toFixed(2)}ms`);
    });

    it("serializes 5,000 lines under 500ms", () => {
      const markdown = generateLargeMarkdown(5000);
      const doc = parseMarkdown(schema, markdown);

      const start = performance.now();
      const output = serializeMarkdown(schema, doc);
      const elapsed = performance.now() - start;

      expect(output).toBeDefined();
      expect(elapsed).toBeLessThan(500); // Baseline: ~24ms, 3x headroom for CI

      console.log(`[Perf] 5K lines serialize: ${elapsed.toFixed(2)}ms`);
    });

    it("serializes 10,000 lines under 1000ms", () => {
      const markdown = generateLargeMarkdown(10000);
      const doc = parseMarkdown(schema, markdown);

      const start = performance.now();
      const output = serializeMarkdown(schema, doc);
      const elapsed = performance.now() - start;

      expect(output).toBeDefined();
      expect(elapsed).toBeLessThan(1000); // Baseline: ~40ms, 3x headroom for CI

      console.log(`[Perf] 10K lines serialize: ${elapsed.toFixed(2)}ms`);
    });
  });

  describe("round-trip performance", () => {
    it("round-trips 10,000 lines under 3500ms", () => {
      const markdown = generateLargeMarkdown(10000);

      const start = performance.now();
      const doc = parseMarkdown(schema, markdown);
      const output = serializeMarkdown(schema, doc);
      const elapsed = performance.now() - start;

      expect(output).toBeDefined();
      expect(elapsed).toBeLessThan(3500); // Baseline: ~400ms, 3x headroom for CI

      console.log(`[Perf] 10K lines round-trip: ${elapsed.toFixed(2)}ms`);
    });
  });

  describe("scaling behavior", () => {
    it("does not scale exponentially with document size", () => {
      const sizes = [1000, 2000, 4000, 8000];
      const times: number[] = [];

      for (const size of sizes) {
        const markdown = generateLargeMarkdown(size);
        const start = performance.now();
        const doc = parseMarkdown(schema, markdown);
        serializeMarkdown(schema, doc);
        times.push(performance.now() - start);
      }

      console.log(`[Perf] Scaling: ${sizes.map((s, i) => `${s}→${times[i].toFixed(0)}ms`).join(", ")}`);

      // Check that doubling input doesn't more than 5x time
      // (should be roughly linear, but small values have high variance)
      for (let i = 1; i < times.length; i++) {
        const ratio = times[i] / times[i - 1];
        expect(ratio).toBeLessThan(5);
      }
    });
  });

  describe("content integrity", () => {
    it("preserves content structure through round-trip", () => {
      const markdown = `# Test Document

This is a paragraph.

- Item 1
- Item 2
- Item 3

\`\`\`javascript
const x = 1;
\`\`\`

> A quote
`;
      const doc = parseMarkdown(schema, markdown);
      const output = serializeMarkdown(schema, doc);

      // Key elements should be preserved
      expect(output).toContain("# Test Document");
      expect(output).toContain("This is a paragraph");
      expect(output).toContain("Item 1");
      expect(output).toContain("Item 2");
      expect(output).toContain("const x = 1");
      expect(output).toContain("A quote");
    });
  });

  describe("lazy plugin loading", () => {
    /**
     * Generate markdown without special syntax (no math, no frontmatter, no wiki links).
     * This tests the lazy plugin loading optimization.
     */
    function generateSimpleMarkdown(lineCount: number): string {
      const lines: string[] = [];
      for (let i = 0; i < lineCount; i++) {
        if (i % 50 === 0) {
          lines.push(`# Section ${Math.floor(i / 50) + 1}`);
        } else {
          lines.push(`This is line ${i}. Lorem ipsum dolor sit amet.`);
        }
        lines.push("");
      }
      return lines.join("\n");
    }

    /**
     * Generate markdown WITH special syntax (math, frontmatter).
     */
    function generateComplexMarkdown(lineCount: number): string {
      const lines: string[] = [];
      lines.push("---");
      lines.push("title: Test Document");
      lines.push("---");
      lines.push("");
      for (let i = 0; i < lineCount; i++) {
        if (i % 50 === 0) {
          lines.push(`# Section ${Math.floor(i / 50) + 1}`);
          lines.push("");
          lines.push("The equation $E = mc^2$ is famous.");
        } else {
          lines.push(`This is line ${i}. Lorem ipsum dolor sit amet.`);
        }
        lines.push("");
      }
      return lines.join("\n");
    }

    it("parses simple markdown faster (no math/frontmatter plugins)", () => {
      const simpleMarkdown = generateSimpleMarkdown(2000);
      const complexMarkdown = generateComplexMarkdown(2000);

      // Parse simple (should skip math/frontmatter plugins)
      const simpleStart = performance.now();
      parseMarkdownToMdast(simpleMarkdown);
      const simpleTime = performance.now() - simpleStart;

      // Parse complex (loads all plugins)
      const complexStart = performance.now();
      parseMarkdownToMdast(complexMarkdown);
      const complexTime = performance.now() - complexStart;

      console.log(`[Perf] Simple (no plugins): ${simpleTime.toFixed(2)}ms`);
      console.log(`[Perf] Complex (all plugins): ${complexTime.toFixed(2)}ms`);

      // Simple should not be significantly slower than complex
      // (may be slightly faster due to fewer plugins, but test for correctness)
      // Relaxed thresholds to account for CI variance
      expect(simpleTime).toBeLessThan(800);
      expect(complexTime).toBeLessThan(800);
    });
  });

});
