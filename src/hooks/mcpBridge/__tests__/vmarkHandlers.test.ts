/**
 * Tests for vmarkHandlers — vmark.insertMathInline, vmark.insertMathBlock,
 * vmark.insertMermaid, vmark.insertSvg, vmark.insertWikiLink,
 * vmark.cjkPunctuationConvert, vmark.cjkSpacingFix.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
}));

// Mock CJK formatter
vi.mock("@/lib/cjkFormatter/rules", () => ({
  addCJKEnglishSpacing: (text: string) => text.replace(/([\u4e00-\u9fff])([A-Za-z])/g, "$1 $2"),
}));

import {
  handleInsertMathInline,
  handleInsertMathBlock,
  handleInsertMermaid,
  handleInsertSvg,
  handleInsertWikiLink,
  handleCjkPunctuationConvert,
  handleCjkSpacingFix,
} from "../vmarkHandlers";

function createMockEditor(overrides?: Record<string, unknown>) {
  const chainMethods = {
    focus: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    deleteRange: vi.fn().mockReturnThis(),
    insertContentAt: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };
  return {
    commands: {},
    chain: vi.fn().mockReturnValue(chainMethods),
    state: {
      selection: { from: 0, to: 0, empty: true },
      doc: { textBetween: vi.fn().mockReturnValue("") },
    },
    ...overrides,
    _chainMethods: chainMethods,
  };
}

describe("vmarkHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleInsertMathInline", () => {
    it("inserts inline math node", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleInsertMathInline("req-1", { latex: "E = mc^2" });

      expect(editor._chainMethods.insertContent).toHaveBeenCalledWith({
        type: "math_inline",
        attrs: { content: "E = mc^2" },
      });
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: null,
      });
    });

    it("returns error when latex is missing", async () => {
      mockGetEditor.mockReturnValue(createMockEditor());

      await handleInsertMathInline("req-2", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-2",
        success: false,
        error: "latex is required",
      });
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleInsertMathInline("req-3", { latex: "x" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-3",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleInsertMathBlock", () => {
    it("inserts code block with latex language", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleInsertMathBlock("req-4", { latex: "\\sum_{i=1}^n" });

      expect(editor._chainMethods.insertContent).toHaveBeenCalledWith({
        type: "codeBlock",
        attrs: { language: "latex" },
        content: [{ type: "text", text: "\\sum_{i=1}^n" }],
      });
    });

    it("returns error when latex is missing", async () => {
      mockGetEditor.mockReturnValue(createMockEditor());

      await handleInsertMathBlock("req-5", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: "latex is required",
      });
    });
  });

  describe("handleInsertMermaid", () => {
    it("inserts code block with mermaid language", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleInsertMermaid("req-6", { code: "graph LR\n  A-->B" });

      expect(editor._chainMethods.insertContent).toHaveBeenCalledWith({
        type: "codeBlock",
        attrs: { language: "mermaid" },
        content: [{ type: "text", text: "graph LR\n  A-->B" }],
      });
    });

    it("returns error when code is missing", async () => {
      mockGetEditor.mockReturnValue(createMockEditor());

      await handleInsertMermaid("req-7", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-7",
        success: false,
        error: "code is required",
      });
    });
  });

  describe("handleInsertSvg", () => {
    it("inserts code block with svg language", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleInsertSvg("req-8", { code: "<svg></svg>" });

      expect(editor._chainMethods.insertContent).toHaveBeenCalledWith({
        type: "codeBlock",
        attrs: { language: "svg" },
        content: [{ type: "text", text: "<svg></svg>" }],
      });
    });
  });

  describe("handleInsertWikiLink", () => {
    it("inserts wiki link with target only", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleInsertWikiLink("req-9", { target: "MyPage" });

      expect(editor._chainMethods.insertContent).toHaveBeenCalledWith({
        type: "wikiLink",
        attrs: { value: "MyPage", alias: null },
      });
    });

    it("inserts wiki link with display text", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleInsertWikiLink("req-10", {
        target: "MyPage",
        displayText: "My Link",
      });

      expect(editor._chainMethods.insertContent).toHaveBeenCalledWith({
        type: "wikiLink",
        attrs: { value: "MyPage", alias: "My Link" },
      });
    });

    it("returns error when target is missing", async () => {
      mockGetEditor.mockReturnValue(createMockEditor());

      await handleInsertWikiLink("req-11", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-11",
        success: false,
        error: "target is required",
      });
    });
  });

  describe("handleCjkPunctuationConvert", () => {
    it("converts half-width to full-width", async () => {
      const editor = createMockEditor({
        state: {
          selection: { from: 0, to: 5, empty: false },
          doc: { textBetween: vi.fn().mockReturnValue("Hello, world!") },
        },
      });
      mockGetEditor.mockReturnValue(editor);

      await handleCjkPunctuationConvert("req-12", {
        direction: "to-fullwidth",
      });

      expect(editor._chainMethods.insertContentAt).toHaveBeenCalledWith(
        0,
        expect.stringContaining("，")
      );
    });

    it("returns error for invalid direction", async () => {
      mockGetEditor.mockReturnValue(createMockEditor());

      await handleCjkPunctuationConvert("req-13", { direction: "invalid" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-13",
        success: false,
        error: 'direction must be "to-fullwidth" or "to-halfwidth"',
      });
    });

    it("returns error when no text selected", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleCjkPunctuationConvert("req-14", {
        direction: "to-fullwidth",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-14",
        success: false,
        error: "No text selected",
      });
    });
  });

  describe("handleCjkSpacingFix", () => {
    it("returns error for invalid action", async () => {
      mockGetEditor.mockReturnValue(createMockEditor());

      await handleCjkSpacingFix("req-15", { action: "invalid" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-15",
        success: false,
        error: 'action must be "add" or "remove"',
      });
    });

    it("returns error when no text selected", async () => {
      mockGetEditor.mockReturnValue(createMockEditor());

      await handleCjkSpacingFix("req-16", { action: "add" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-16",
        success: false,
        error: "No text selected",
      });
    });

    it("adds CJK spacing when action is add", async () => {
      const editor = createMockEditor({
        state: {
          selection: { from: 0, to: 10, empty: false },
          doc: { textBetween: vi.fn().mockReturnValue("你好world") },
        },
      });
      mockGetEditor.mockReturnValue(editor);

      await handleCjkSpacingFix("req-17", { action: "add" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-17",
        success: true,
        data: null,
      });
    });
  });
});
