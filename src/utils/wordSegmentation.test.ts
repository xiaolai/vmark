// @vitest-environment node
/**
 * Word Segmentation Tests
 *
 * Tests for the shared word boundary detection utility.
 * Covers ASCII, CJK (Chinese, Japanese), and fallback scenarios.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findWordBoundaries, findWordEdge, getWordSegments, _resetSegmenterCache } from "./wordSegmentation";

describe("wordSegmentation", () => {
  beforeEach(() => {
    // Reset cached segmenter before each test
    _resetSegmenterCache();
  });

  describe("findWordBoundaries - ASCII text", () => {
    it("should find word at cursor position", () => {
      const text = "hello world";
      // Cursor in "hello" at position 2 (between 'e' and 'l')
      const result = findWordBoundaries(text, 2);
      expect(result).toEqual({ start: 0, end: 5 });
    });

    it("should find word at start of text", () => {
      const text = "hello world";
      // Cursor at position 1 (in 'hello')
      const result = findWordBoundaries(text, 1);
      expect(result).toEqual({ start: 0, end: 5 });
    });

    it("should find word at end of text", () => {
      const text = "hello world";
      // Cursor at position 9 (in 'world')
      const result = findWordBoundaries(text, 9);
      expect(result).toEqual({ start: 6, end: 11 });
    });

    it("should return null for whitespace", () => {
      const text = "hello world";
      // Cursor at space (position 5)
      const result = findWordBoundaries(text, 5);
      expect(result).toBeNull();
    });

    it("should return null for punctuation", () => {
      const text = "hello, world";
      // Cursor at comma (position 5)
      const result = findWordBoundaries(text, 5);
      expect(result).toBeNull();
    });

    it("should return null when cursor at word boundary (start)", () => {
      const text = "hello world";
      // Cursor at position 0 (before 'h')
      const result = findWordBoundaries(text, 0);
      expect(result).toBeNull();
    });

    it("should return null when cursor at word boundary (end)", () => {
      const text = "hello world";
      // Cursor at position 5 (after 'o', before space)
      const result = findWordBoundaries(text, 5);
      expect(result).toBeNull();
    });

    it("should handle hyphenated words as separate words", () => {
      const text = "self-aware";
      // Cursor in 'self' (position 2)
      const result = findWordBoundaries(text, 2);
      expect(result).toEqual({ start: 0, end: 4 });
    });

    it("should handle numbers as words", () => {
      const text = "test123 value";
      // Cursor in 'test123' (position 3)
      const result = findWordBoundaries(text, 3);
      // Intl.Segmenter may treat "test123" as one word or split it
      // The key is that we get a valid word range containing pos 3
      expect(result).not.toBeNull();
      expect(result!.start).toBeLessThanOrEqual(3);
      expect(result!.end).toBeGreaterThan(3);
    });
  });

  describe("findWordEdge - ASCII text", () => {
    it("moves left to word start when inside a word", () => {
      const text = "hello world";
      const result = findWordEdge(text, 2, -1);
      expect(result).toBe(0);
    });

    it("moves right to word end when inside a word", () => {
      const text = "hello world";
      const result = findWordEdge(text, 2, 1);
      expect(result).toBe(5);
    });

    it("skips to next word end from whitespace", () => {
      const text = "hello world";
      const result = findWordEdge(text, 5, 1);
      expect(result).toBe(11);
    });

    it("skips to previous word start from whitespace", () => {
      const text = "hello world";
      const result = findWordEdge(text, 5, -1);
      expect(result).toBe(0);
    });
  });

  describe("findWordBoundaries - CJK text", () => {
    it("should segment Chinese characters", () => {
      const text = "你好世界"; // "Hello world" in Chinese
      // Cursor at position 1 (inside 你好)
      const result = findWordBoundaries(text, 1);
      // Intl.Segmenter should recognize "你好" (hello) as a word
      expect(result).not.toBeNull();
      expect(result!.start).toBe(0);
    });

    it("should return null at Chinese word boundary", () => {
      const text = "你好世界";
      // Position 2 is exactly at boundary between 你好 and 世界
      const result = findWordBoundaries(text, 2);
      expect(result).toBeNull();
    });

    it("should segment Japanese text", () => {
      const text = "こんにちは"; // "Hello" in Japanese hiragana
      // Cursor at position 3
      const result = findWordBoundaries(text, 3);
      expect(result).not.toBeNull();
    });

    it("should handle mixed CJK and ASCII", () => {
      const text = "hello你好world";
      // Cursor in 'hello' (position 2)
      const result = findWordBoundaries(text, 2);
      expect(result).toEqual({ start: 0, end: 5 });
    });

    it("should return identical ranges for same text regardless of caller", () => {
      // This test ensures consistency between WYSIWYG and Source
      const text = "你好世界";
      const pos = 1;

      const result1 = findWordBoundaries(text, pos);
      const result2 = findWordBoundaries(text, pos);

      expect(result1).toEqual(result2);
    });
  });

  describe("findWordBoundaries - edge cases", () => {
    it("should return null for empty text", () => {
      const result = findWordBoundaries("", 0);
      expect(result).toBeNull();
    });

    it("should return null when position is out of bounds", () => {
      const text = "hello";
      const result = findWordBoundaries(text, 10);
      expect(result).toBeNull();
    });

    it("should return null for negative position", () => {
      const text = "hello";
      const result = findWordBoundaries(text, -1);
      expect(result).toBeNull();
    });

    it("should handle text with only whitespace", () => {
      const text = "   ";
      const result = findWordBoundaries(text, 1);
      expect(result).toBeNull();
    });

    it("should handle text with only punctuation", () => {
      const text = "...";
      const result = findWordBoundaries(text, 1);
      expect(result).toBeNull();
    });

    it("should return null for single character word at boundary", () => {
      const text = "a b c";
      // Position 2 is exactly at 'b' start (boundary)
      const result = findWordBoundaries(text, 2);
      // Single char word: can't be strictly inside
      expect(result).toBeNull();
    });

    it("should find multi-char words surrounded by spaces", () => {
      const text = "a bb c";
      // Position 3 is inside 'bb'
      const result = findWordBoundaries(text, 3);
      expect(result).toEqual({ start: 2, end: 4 });
    });
  });

  describe("findWordBoundaries - fallback behavior", () => {
    // Test regex fallback when Intl.Segmenter is unavailable
    let originalSegmenter: unknown;

    beforeEach(() => {
      // Save original
      originalSegmenter = (Intl as Record<string, unknown>).Segmenter;
    });

    afterEach(() => {
      // Restore original
      if (originalSegmenter) {
        (Intl as Record<string, unknown>).Segmenter = originalSegmenter;
      } else {
        delete (Intl as Record<string, unknown>).Segmenter;
      }
      _resetSegmenterCache();
    });

    it("should fall back to regex when Segmenter unavailable", () => {
      // Remove Segmenter
      delete (Intl as Record<string, unknown>).Segmenter;
      _resetSegmenterCache();

      const text = "hello world";
      const result = findWordBoundaries(text, 2);

      // Should still find word using regex fallback
      expect(result).toEqual({ start: 0, end: 5 });
    });

    it("should handle Latin extended characters in fallback", () => {
      delete (Intl as Record<string, unknown>).Segmenter;
      _resetSegmenterCache();

      const text = "café résumé";
      const result = findWordBoundaries(text, 2);

      expect(result).toEqual({ start: 0, end: 4 });
    });

    it("returns null at position 0 in fallback (boundary)", () => {
      delete (Intl as Record<string, unknown>).Segmenter;
      _resetSegmenterCache();

      const result = findWordBoundaries("hello", 0);
      expect(result).toBeNull();
    });

    it("returns null at end of text in fallback (boundary)", () => {
      delete (Intl as Record<string, unknown>).Segmenter;
      _resetSegmenterCache();

      const result = findWordBoundaries("hello", 5);
      expect(result).toBeNull();
    });

    it("returns null for non-word chars at position in fallback", () => {
      delete (Intl as Record<string, unknown>).Segmenter;
      _resetSegmenterCache();

      const result = findWordBoundaries("   ", 1);
      expect(result).toBeNull();
    });

    it("returns null when cursor is at word boundary (start == posInText) in fallback", () => {
      delete (Intl as Record<string, unknown>).Segmenter;
      _resetSegmenterCache();

      // "a b" — pos=2 is at start of "b", but single char word: start=2, end=3, posInText=2 == start
      const result = findWordBoundaries("a b", 2);
      expect(result).toBeNull();
    });
  });

  describe("getWordSegments", () => {
    it("returns empty array for empty text", () => {
      expect(getWordSegments("")).toEqual([]);
    });

    it("returns word segments for simple text", () => {
      const segments = getWordSegments("hello world");
      expect(segments.length).toBeGreaterThanOrEqual(2);
      expect(segments[0]).toEqual({ start: 0, end: 5 });
    });

    it("returns word segments using regex fallback", () => {
      const originalSegmenter = (Intl as Record<string, unknown>).Segmenter;
      delete (Intl as Record<string, unknown>).Segmenter;
      _resetSegmenterCache();

      const segments = getWordSegments("hello world test");
      expect(segments).toEqual([
        { start: 0, end: 5 },
        { start: 6, end: 11 },
        { start: 12, end: 16 },
      ]);

      (Intl as Record<string, unknown>).Segmenter = originalSegmenter;
      _resetSegmenterCache();
    });

    it("regex fallback handles text with only non-word chars", () => {
      const originalSegmenter = (Intl as Record<string, unknown>).Segmenter;
      delete (Intl as Record<string, unknown>).Segmenter;
      _resetSegmenterCache();

      const segments = getWordSegments("... --- !!!");
      expect(segments).toEqual([]);

      (Intl as Record<string, unknown>).Segmenter = originalSegmenter;
      _resetSegmenterCache();
    });
  });

  describe("findWordEdge - additional cases", () => {
    it("returns null for empty text", () => {
      expect(findWordEdge("", 0, 1)).toBeNull();
      expect(findWordEdge("", 0, -1)).toBeNull();
    });

    it("returns null for text with no word segments", () => {
      expect(findWordEdge("   ", 1, 1)).toBeNull();
      expect(findWordEdge("   ", 1, -1)).toBeNull();
    });

    it("returns last segment end when moving right past all segments", () => {
      const text = "hello world";
      // Position past end of last word
      const result = findWordEdge(text, 11, 1);
      expect(result).toBe(11);
    });

    it("returns first segment start when moving left past all segments", () => {
      const text = "hello world";
      const result = findWordEdge(text, 0, -1);
      expect(result).toBe(0);
    });

    it("clamps out-of-bounds position", () => {
      const text = "hello";
      // Position beyond text length
      const result = findWordEdge(text, 100, -1);
      expect(result).toBe(0);
    });

    it("moves left to previous word start when between words", () => {
      const text = "hello world test";
      // Position between "world" and "test" (at space)
      const result = findWordEdge(text, 12, -1);
      expect(result).toBe(6);
    });

    it("moves left finding word start when pos > seg.end (line 122)", () => {
      // Create a scenario where we iterate backwards through segments
      // and pos > seg.end for the current segment
      const text = "abc   xyz";
      // pos=5 is in the whitespace gap, past end of "abc" (end=3)
      // dir=-1: iterating backwards, segments = [{0,3}, {6,9}]
      // seg={6,9}: pos=5 <= start=6, so continue
      // seg={0,3}: pos=5 > end=3, so return start=0
      const result = findWordEdge(text, 5, -1);
      expect(result).toBe(0);
    });

    it("moves right from before first word to first word end", () => {
      const text = "  hello";
      const result = findWordEdge(text, 0, 1);
      // pos=0 < seg.start=2, so return seg.end=7
      expect(result).toBe(7);
    });

    it("moves left returning first segment start as fallback (line 126)", () => {
      const text = "hello world";
      // pos=0, dir=-1: no segment has pos > seg.start, so falls through to return segments[0].start
      const result = findWordEdge(text, 0, -1);
      expect(result).toBe(0);
    });
  });
});
