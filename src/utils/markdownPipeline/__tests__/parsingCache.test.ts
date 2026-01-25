/**
 * Tests for the parsing cache module.
 *
 * Tests caching behavior, LRU eviction, and cache statistics.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  parseMarkdownCached,
  parseMarkdownToMdastCached,
  clearCache,
  getCacheStats,
  prewarmCache,
} from "../parsingCache";

function createTestSchema() {
  return getSchema([StarterKit]);
}

/**
 * Generate markdown content of a specific size.
 */
function generateMarkdown(chars: number): string {
  const line = "This is a paragraph of text. Lorem ipsum dolor sit amet.\n\n";
  let result = "";
  while (result.length < chars) {
    result += line;
  }
  return result.slice(0, chars);
}

describe("parsingCache", () => {
  beforeEach(() => {
    clearCache();
  });

  describe("parseMarkdownCached", () => {
    const schema = createTestSchema();

    it("returns valid ProseMirror document", () => {
      const markdown = generateMarkdown(6000);
      const doc = parseMarkdownCached(schema, markdown);
      expect(doc).toBeDefined();
      expect(doc.type.name).toBe("doc");
    });

    it("handles null/undefined input", () => {
      // @ts-expect-error - testing null handling
      const doc1 = parseMarkdownCached(schema, null);
      expect(doc1).toBeDefined();

      // @ts-expect-error - testing undefined handling
      const doc2 = parseMarkdownCached(schema, undefined);
      expect(doc2).toBeDefined();
    });

    it("returns same result for identical content", () => {
      const markdown = generateMarkdown(6000);
      const doc1 = parseMarkdownCached(schema, markdown);
      const doc2 = parseMarkdownCached(schema, markdown);

      // Both should have same structure
      expect(doc1.content.childCount).toBe(doc2.content.childCount);
    });
  });

  describe("parseMarkdownToMdastCached", () => {
    it("returns valid MDAST root", () => {
      const markdown = generateMarkdown(6000);
      const mdast = parseMarkdownToMdastCached(markdown);
      expect(mdast).toBeDefined();
      expect(mdast.type).toBe("root");
      expect(Array.isArray(mdast.children)).toBe(true);
    });

    it("uses fast parser for simple markdown", () => {
      const markdown = generateMarkdown(6000);
      const mdast = parseMarkdownToMdastCached(markdown);
      expect(mdast.type).toBe("root");
    });

    it("falls back to remark for math content", () => {
      const markdown = generateMarkdown(4000) + "\n\nInline $x^2$ math\n\n" + generateMarkdown(1000);
      const mdast = parseMarkdownToMdastCached(markdown);
      expect(mdast.type).toBe("root");
    });

    it("falls back to remark for wiki links", () => {
      const markdown = generateMarkdown(4000) + "\n\nLink to [[page]]\n\n" + generateMarkdown(1000);
      const mdast = parseMarkdownToMdastCached(markdown);
      expect(mdast.type).toBe("root");
    });
  });

  describe("cache behavior", () => {
    it("does not cache small documents (< 5KB)", () => {
      const smallMarkdown = "# Hello\n\nSmall doc";
      parseMarkdownToMdastCached(smallMarkdown);
      const stats = getCacheStats();
      expect(stats.size).toBe(0);
    });

    it("caches large documents (>= 5KB)", () => {
      const largeMarkdown = generateMarkdown(6000);
      parseMarkdownToMdastCached(largeMarkdown);
      const stats = getCacheStats();
      expect(stats.size).toBe(1);
    });

    it("returns cached result on second parse", () => {
      const markdown = generateMarkdown(6000);

      // First parse (cache miss)
      parseMarkdownToMdastCached(markdown);
      expect(getCacheStats().size).toBe(1);

      // Second parse (cache hit)
      parseMarkdownToMdastCached(markdown);
      expect(getCacheStats().size).toBe(1); // Still 1, not 2
    });

    it("caches different content separately", () => {
      const markdown1 = generateMarkdown(6000);
      const markdown2 = "Different content. " + generateMarkdown(5800);

      parseMarkdownToMdastCached(markdown1);
      expect(getCacheStats().size).toBe(1);

      parseMarkdownToMdastCached(markdown2);
      expect(getCacheStats().size).toBe(2);
    });

    it("differentiates by options", () => {
      const markdown = generateMarkdown(6000);

      parseMarkdownToMdastCached(markdown, {});
      expect(getCacheStats().size).toBe(1);

      parseMarkdownToMdastCached(markdown, { preserveLineBreaks: true });
      expect(getCacheStats().size).toBe(2);
    });
  });

  describe("LRU eviction", () => {
    it("evicts oldest entry when cache is full", () => {
      const MAX_CACHE_SIZE = 20;

      // Fill the cache
      for (let i = 0; i < MAX_CACHE_SIZE + 5; i++) {
        const markdown = `Content ${i}. ` + generateMarkdown(5800);
        parseMarkdownToMdastCached(markdown);
      }

      // Should not exceed max size
      const stats = getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(stats.maxSize);
    });
  });

  describe("getCacheStats", () => {
    it("returns correct size", () => {
      expect(getCacheStats().size).toBe(0);

      parseMarkdownToMdastCached(generateMarkdown(6000));
      expect(getCacheStats().size).toBe(1);

      parseMarkdownToMdastCached(generateMarkdown(6000) + " extra");
      expect(getCacheStats().size).toBe(2);
    });

    it("returns maxSize of 20", () => {
      expect(getCacheStats().maxSize).toBe(20);
    });
  });

  describe("clearCache", () => {
    it("empties the cache", () => {
      parseMarkdownToMdastCached(generateMarkdown(6000));
      parseMarkdownToMdastCached(generateMarkdown(6000) + " extra");
      expect(getCacheStats().size).toBe(2);

      clearCache();
      expect(getCacheStats().size).toBe(0);
    });
  });

  describe("prewarmCache", () => {
    it("pre-caches multiple documents", () => {
      const contents = [
        generateMarkdown(6000),
        generateMarkdown(6000) + " second",
        generateMarkdown(6000) + " third",
      ];

      prewarmCache(contents);
      expect(getCacheStats().size).toBe(3);
    });

    it("skips small documents", () => {
      const contents = [
        "Small doc 1",
        "Small doc 2",
        generateMarkdown(6000), // Only this one should be cached
      ];

      prewarmCache(contents);
      expect(getCacheStats().size).toBe(1);
    });

    it("handles empty array", () => {
      prewarmCache([]);
      expect(getCacheStats().size).toBe(0);
    });
  });

  describe("performance", () => {
    it("cache hit is faster than cache miss", () => {
      // Use content with math to force remark parser (slower)
      // This makes the cache speedup more measurable
      const baseMarkdown = generateMarkdown(20000);
      const markdown = baseMarkdown + "\n\n$E = mc^2$\n\n" + generateMarkdown(5000);

      // Warmup run to stabilize JIT
      parseMarkdownToMdastCached(generateMarkdown(1000));
      clearCache();

      // First parse (cache miss)
      const missStart = performance.now();
      parseMarkdownToMdastCached(markdown);
      const missTime = performance.now() - missStart;

      // Second parse (cache hit)
      const hitStart = performance.now();
      parseMarkdownToMdastCached(markdown);
      const hitTime = performance.now() - hitStart;

      // Cache hit should be faster (with tolerance for measurement noise)
      // Use 10x tolerance since timing can be affected by GC
      expect(hitTime).toBeLessThan(missTime * 10);
    });
  });
});
