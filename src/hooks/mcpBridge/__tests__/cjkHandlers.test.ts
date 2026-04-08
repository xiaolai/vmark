/**
 * Tests for cjkHandlers — punctuation conversion maps and round-trip behavior,
 * plus handler validation paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils for handler tests
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
}));

// Mock imports used by handleCjkFormat
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: { getState: () => ({ cjkFormatting: {} }) },
}));
vi.mock("@/lib/cjkFormatter/rules", () => ({
  addCJKEnglishSpacing: (s: string) => s,
}));
vi.mock("@/lib/cjkFormatter", () => ({
  formatMarkdown: (s: string) => s,
}));
vi.mock("@/utils/markdownPipeline", () => ({
  parseMarkdown: vi.fn(),
  serializeMarkdown: vi.fn(),
}));
vi.mock("@/plugins/toolbarActions/wysiwygAdapterUtils", () => ({
  getSerializeOptions: () => ({}),
  shouldPreserveTwoSpaceBreaks: () => false,
}));

import {
  HALF_TO_FULL,
  FULL_TO_HALF,
} from "../cjkHandlers";
import {
  handleCjkPunctuationConvert,
  handleCjkSpacingFix,
} from "../cjkHandlers";

describe("cjkHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("punctuation maps", () => {
    it("HALF_TO_FULL covers all common punctuation", () => {
      const expected = [",", ".", "!", "?", ";", ":", "(", ")"];
      for (const char of expected) {
        expect(HALF_TO_FULL[char]).toBeDefined();
      }
    });

    it("FULL_TO_HALF is exact inverse of HALF_TO_FULL", () => {
      expect(Object.keys(FULL_TO_HALF).length).toBe(
        Object.keys(HALF_TO_FULL).length
      );
      for (const [half, full] of Object.entries(HALF_TO_FULL)) {
        expect(FULL_TO_HALF[full]).toBe(half);
      }
    });

    it("round-trip: halfwidth -> fullwidth -> halfwidth", () => {
      const original = "Hello, world! How are you? Fine; thanks: (ok).";
      let converted = original;
      for (const [half, full] of Object.entries(HALF_TO_FULL)) {
        converted = converted.split(half).join(full);
      }
      // Should have no halfwidth punctuation left
      expect(converted).not.toContain(",");
      expect(converted).toContain("\uFF0C");

      // Convert back
      let restored = converted;
      for (const [full, half] of Object.entries(FULL_TO_HALF)) {
        restored = restored.split(full).join(half);
      }
      expect(restored).toBe(original);
    });

    it("round-trip: fullwidth -> halfwidth -> fullwidth", () => {
      const original =
        "\u4F60\u597D\uFF0C\u4E16\u754C\uFF01\u5982\u4F55\uFF1F\u597D\uFF1B\u8C22\u8C22\uFF1A\uFF08\u597D\uFF09\u3002";
      let converted = original;
      for (const [full, half] of Object.entries(FULL_TO_HALF)) {
        converted = converted.split(full).join(half);
      }
      let restored = converted;
      for (const [half, full] of Object.entries(HALF_TO_FULL)) {
        restored = restored.split(half).join(full);
      }
      expect(restored).toBe(original);
    });

    it("fullwidth values are unique (no collisions)", () => {
      const fullValues = Object.values(HALF_TO_FULL);
      expect(new Set(fullValues).size).toBe(fullValues.length);
    });

    it("maps correct unicode codepoints", () => {
      expect(HALF_TO_FULL[","]).toBe("\uFF0C"); // fullwidth comma
      expect(HALF_TO_FULL["."]).toBe("\u3002"); // ideographic period
      expect(HALF_TO_FULL["!"]).toBe("\uFF01"); // fullwidth exclamation
      expect(HALF_TO_FULL["?"]).toBe("\uFF1F"); // fullwidth question
      expect(HALF_TO_FULL[";"]).toBe("\uFF1B"); // fullwidth semicolon
      expect(HALF_TO_FULL[":"]).toBe("\uFF1A"); // fullwidth colon
      expect(HALF_TO_FULL["("]).toBe("\uFF08"); // fullwidth left paren
      expect(HALF_TO_FULL[")"]).toBe("\uFF09"); // fullwidth right paren
    });
  });

  describe("handleCjkPunctuationConvert", () => {
    it("responds with error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);
      await handleCjkPunctuationConvert("req-1", {
        direction: "to-fullwidth",
      });
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "req-1",
          success: false,
          error: "No active editor",
        })
      );
    });

    it("responds with error for invalid direction", async () => {
      mockGetEditor.mockReturnValue({
        state: { selection: { from: 0, to: 5, empty: false } },
      });
      await handleCjkPunctuationConvert("req-2", {
        direction: "invalid",
      });
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining("to-fullwidth"),
        })
      );
    });

    it("responds with error when selection is empty", async () => {
      mockGetEditor.mockReturnValue({
        state: { selection: { from: 0, to: 0, empty: true } },
      });
      await handleCjkPunctuationConvert("req-3", {
        direction: "to-fullwidth",
      });
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "No text selected",
        })
      );
    });
  });

  describe("handleCjkSpacingFix", () => {
    it("responds with error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);
      await handleCjkSpacingFix("req-4", { action: "add" });
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "No active editor",
        })
      );
    });

    it("responds with error for invalid action", async () => {
      mockGetEditor.mockReturnValue({
        state: { selection: { from: 0, to: 5, empty: false } },
      });
      await handleCjkSpacingFix("req-5", { action: "invalid" });
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining("add"),
        })
      );
    });

    it("responds with error when selection is empty", async () => {
      mockGetEditor.mockReturnValue({
        state: { selection: { from: 0, to: 0, empty: true } },
      });
      await handleCjkSpacingFix("req-6", { action: "add" });
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "No text selected",
        })
      );
    });
  });
});
