/**
 * MCP Bridge — VMark Handler Tests
 *
 * Tests for VMark-specific operations: math, mermaid, markmap, SVG,
 * wiki links, CJK punctuation, and CJK spacing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleInsertMathInline,
  handleInsertMathBlock,
  handleInsertMermaid,
  handleInsertMarkmap,
  handleInsertSvg,
  handleInsertWikiLink,
  handleCjkPunctuationConvert,
  handleCjkSpacingFix,
} from "./vmarkHandlers";

vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
}));

vi.mock("@/lib/cjkFormatter/rules", () => ({
  addCJKEnglishSpacing: vi.fn((text: string) => text.replace(/([\u4e00-\u9fff])([A-Za-z])/g, "$1 $2")),
}));

import { respond, getEditor } from "./utils";

function createMockEditor(options: {
  selectionFrom?: number;
  selectionTo?: number;
  selectionEmpty?: boolean;
  selectedText?: string;
} = {}) {
  const { selectionFrom = 0, selectionTo = 0, selectionEmpty = true, selectedText = "" } = options;
  const mockChain = {
    focus: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    deleteRange: vi.fn().mockReturnThis(),
    insertContentAt: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };
  return {
    chain: vi.fn(() => mockChain),
    state: {
      selection: { from: selectionFrom, to: selectionTo, empty: selectionEmpty },
      doc: {
        textBetween: vi.fn(() => selectedText),
      },
    },
    commands: {},
    mockChain,
  };
}

describe("vmarkHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleInsertMathInline", () => {
    it("inserts math_inline node", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertMathInline("req-1", { latex: "E=mc^2" });

      expect(editor.mockChain.insertContent).toHaveBeenCalledWith({
        type: "math_inline",
        attrs: { content: "E=mc^2" },
      });
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("returns error when latex missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleInsertMathInline("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "latex is required",
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleInsertMathInline("req-1", { latex: "x" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleInsertMathBlock", () => {
    it("inserts code block with latex language", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertMathBlock("req-1", { latex: "\\sum_{i=1}^n x_i" });

      expect(editor.mockChain.insertContent).toHaveBeenCalledWith({
        type: "codeBlock",
        attrs: { language: "latex" },
        content: [{ type: "text", text: "\\sum_{i=1}^n x_i" }],
      });
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("returns error when latex missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleInsertMathBlock("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "latex is required",
      });
    });
  });

  describe("handleInsertMermaid", () => {
    it("inserts mermaid code block", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertMermaid("req-1", { code: "graph TD\n  A-->B" });

      expect(editor.mockChain.insertContent).toHaveBeenCalledWith({
        type: "codeBlock",
        attrs: { language: "mermaid" },
        content: [{ type: "text", text: "graph TD\n  A-->B" }],
      });
    });

    it("returns error when code missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleInsertMermaid("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "code is required",
      });
    });
  });

  describe("handleInsertMarkmap", () => {
    it("inserts markmap code block", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertMarkmap("req-1", { code: "# Root\n## Child" });

      expect(editor.mockChain.insertContent).toHaveBeenCalledWith({
        type: "codeBlock",
        attrs: { language: "markmap" },
        content: [{ type: "text", text: "# Root\n## Child" }],
      });
    });
  });

  describe("handleInsertSvg", () => {
    it("inserts SVG code block", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertSvg("req-1", { code: "<svg></svg>" });

      expect(editor.mockChain.insertContent).toHaveBeenCalledWith({
        type: "codeBlock",
        attrs: { language: "svg" },
        content: [{ type: "text", text: "<svg></svg>" }],
      });
    });
  });

  describe("handleInsertWikiLink", () => {
    it("inserts wiki link with target", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertWikiLink("req-1", { target: "PageName" });

      expect(editor.mockChain.insertContent).toHaveBeenCalledWith({
        type: "wikiLink",
        attrs: { value: "PageName", alias: null },
      });
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("inserts wiki link with display text", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertWikiLink("req-1", { target: "PageName", displayText: "Custom Label" });

      expect(editor.mockChain.insertContent).toHaveBeenCalledWith({
        type: "wikiLink",
        attrs: { value: "PageName", alias: "Custom Label" },
      });
    });

    it("returns error when target missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleInsertWikiLink("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "target is required",
      });
    });
  });

  describe("handleCjkPunctuationConvert", () => {
    it("converts half-width to full-width", async () => {
      const editor = createMockEditor({
        selectionFrom: 0,
        selectionTo: 5,
        selectionEmpty: false,
        selectedText: "Hello, world!",
      });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCjkPunctuationConvert("req-1", { direction: "to-fullwidth" });

      expect(editor.mockChain.deleteRange).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("returns error for invalid direction", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleCjkPunctuationConvert("req-1", { direction: "invalid" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: 'direction must be "to-fullwidth" or "to-halfwidth"',
      });
    });

    it("returns error when no text selected", async () => {
      vi.mocked(getEditor).mockReturnValue(
        createMockEditor({ selectionEmpty: true }) as never,
      );

      await handleCjkPunctuationConvert("req-1", { direction: "to-fullwidth" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No text selected",
      });
    });
  });

  describe("handleCjkSpacingFix", () => {
    it("adds CJK-English spacing", async () => {
      const editor = createMockEditor({
        selectionFrom: 0,
        selectionTo: 10,
        selectionEmpty: false,
        selectedText: "中文text",
      });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCjkSpacingFix("req-1", { action: "add" });

      expect(editor.mockChain.deleteRange).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("removes CJK-English spacing", async () => {
      const editor = createMockEditor({
        selectionFrom: 0,
        selectionTo: 10,
        selectionEmpty: false,
        selectedText: "中文 text",
      });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCjkSpacingFix("req-1", { action: "remove" });

      expect(editor.mockChain.deleteRange).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("returns error for invalid action", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleCjkSpacingFix("req-1", { action: "invalid" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: 'action must be "add" or "remove"',
      });
    });

    it("returns error when no text selected", async () => {
      vi.mocked(getEditor).mockReturnValue(
        createMockEditor({ selectionEmpty: true }) as never,
      );

      await handleCjkSpacingFix("req-1", { action: "add" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No text selected",
      });
    });
  });
});
