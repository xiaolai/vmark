// @vitest-environment node
import { describe, it, expect } from "vitest";
import { extractCursorContext } from "./matching";

describe("extractCursorContext", () => {
  describe("empty/invalid input", () => {
    it("returns empty context for empty text", () => {
      const result = extractCursorContext("", 0);
      expect(result).toEqual({
        word: "",
        offsetInWord: 0,
        contextBefore: "",
        contextAfter: "",
      });
    });

    it("returns empty context for negative position", () => {
      const result = extractCursorContext("hello", -1);
      expect(result).toEqual({
        word: "",
        offsetInWord: 0,
        contextBefore: "",
        contextAfter: "",
      });
    });

    it("returns empty context for empty text with positive position", () => {
      const result = extractCursorContext("", 5);
      expect(result).toEqual({
        word: "",
        offsetInWord: 0,
        contextBefore: "",
        contextAfter: "",
      });
    });
  });

  describe("word extraction", () => {
    it("extracts word when cursor is at start of word", () => {
      const result = extractCursorContext("hello world", 0);
      expect(result.word).toBe("hello");
      expect(result.offsetInWord).toBe(0);
    });

    it("extracts word when cursor is in middle of word", () => {
      const result = extractCursorContext("hello world", 3);
      expect(result.word).toBe("hello");
      expect(result.offsetInWord).toBe(3);
    });

    it("extracts word when cursor is at end of word", () => {
      const result = extractCursorContext("hello world", 5);
      expect(result.word).toBe("hello");
      expect(result.offsetInWord).toBe(5);
    });

    it("extracts second word when cursor is inside it", () => {
      const result = extractCursorContext("hello world", 7);
      expect(result.word).toBe("world");
      expect(result.offsetInWord).toBe(1);
    });

    it("returns empty word when cursor is on whitespace", () => {
      const result = extractCursorContext("hello   world", 6);
      expect(result.word).toBe("");
      expect(result.offsetInWord).toBe(0);
    });

    it("includes word before punctuation when cursor is at word end", () => {
      const result = extractCursorContext("hello, world", 5);
      // cursor at pos 5 is right after "hello", \w scan goes back to 0
      expect(result.word).toBe("hello");
      expect(result.offsetInWord).toBe(5);
    });
  });

  describe("position clamping", () => {
    it("clamps position to text length", () => {
      const result = extractCursorContext("hi", 100);
      expect(result.contextBefore).toBe("hi");
      expect(result.contextAfter).toBe("");
    });
  });

  describe("context extraction", () => {
    it("extracts context around cursor", () => {
      const result = extractCursorContext("hello world", 5);
      expect(result.contextBefore).toBe("hello");
      expect(result.contextAfter).toBe(" world");
    });

    it("limits context to 20 characters before", () => {
      const longText = "a".repeat(30) + "CURSOR" + "b".repeat(30);
      const pos = 30;
      const result = extractCursorContext(longText, pos);
      expect(result.contextBefore.length).toBe(20);
      expect(result.contextBefore).toBe("a".repeat(20));
    });

    it("limits context to 20 characters after", () => {
      const longText = "a".repeat(30) + "b".repeat(30);
      const pos = 30;
      const result = extractCursorContext(longText, pos);
      expect(result.contextAfter.length).toBe(20);
      expect(result.contextAfter).toBe("b".repeat(20));
    });

    it("handles cursor at start of text", () => {
      const result = extractCursorContext("hello world", 0);
      expect(result.contextBefore).toBe("");
      expect(result.contextAfter).toBe("hello world");
    });

    it("handles cursor at end of text", () => {
      const result = extractCursorContext("hello world", 11);
      expect(result.contextBefore).toBe("hello world");
      expect(result.contextAfter).toBe("");
    });
  });

  describe("CJK text (Unicode-aware word boundaries)", () => {
    it("extracts CJK+ASCII as a single word when contiguous", () => {
      const text = "hello你好world";
      // With Unicode-aware \p{L}, CJK chars ARE word chars
      const result = extractCursorContext(text, 5);
      expect(result.word).toBe("hello你好world");
      expect(result.offsetInWord).toBe(5);
    });

    it("extracts standalone CJK word", () => {
      const text = "这是测试";
      const result = extractCursorContext(text, 2);
      expect(result.word).toBe("这是测试");
      expect(result.offsetInWord).toBe(2);
    });

    it("treats CJK punctuation as word boundary", () => {
      const text = "你好，世界";
      // ，(U+FF0C) is not \p{L}\p{N} — acts as boundary
      const result = extractCursorContext(text, 2);
      expect(result.word).toBe("你好");
      expect(result.offsetInWord).toBe(2);
    });

    it("treats space between CJK and ASCII as word boundary", () => {
      const text = "hello 你好";
      const result = extractCursorContext(text, 3);
      expect(result.word).toBe("hello");
      expect(result.offsetInWord).toBe(3);
    });
  });

  describe("multi-byte characters", () => {
    it("handles emoji in text", () => {
      // JS string indexing is by UTF-16 code units
      const text = "hi there";
      const result = extractCursorContext(text, 2);
      expect(result.contextBefore).toBe("hi");
      expect(result.contextAfter).toContain(" there");
    });
  });
});
