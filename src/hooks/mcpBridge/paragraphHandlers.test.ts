/**
 * MCP Bridge — Paragraph Handler Tests
 *
 * Tests for paragraph.read and paragraph.write handlers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleParagraphRead, handleParagraphWrite } from "./paragraphHandlers";

vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
  isAutoApproveEnabled: vi.fn(() => false),
  getActiveTabId: vi.fn(() => "test-tab"),
}));

vi.mock("./revisionTracker", () => ({
  validateBaseRevision: vi.fn(() => null),
  getCurrentRevision: vi.fn(() => "rev-new"),
}));

vi.mock("@/stores/aiSuggestionStore", () => ({
  useAiSuggestionStore: {
    getState: vi.fn(() => ({
      addSuggestion: vi.fn(() => "sug-1"),
    })),
  },
}));

vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  createMarkdownPasteSlice: vi.fn(() => ({ content: { size: 5 } })),
}));

import { respond, getEditor, isAutoApproveEnabled } from "./utils";
import { validateBaseRevision } from "./revisionTracker";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";

/**
 * Create a mock editor with paragraph descendants.
 */
function createMockEditor(paragraphs: Array<{ text: string }> = [{ text: "hello world" }]) {
  const mockTr = {
    replaceRange: vi.fn().mockReturnThis(),
  };
  const mockChain = {
    focus: vi.fn().mockReturnThis(),
    setTextSelection: vi.fn().mockReturnThis(),
    deleteSelection: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };

  // Build paragraph nodes
  let pos = 0;
  const paraNodes = paragraphs.map((p) => {
    const from = pos;
    const nodeSize = p.text.length + 2; // +2 for open/close tags
    pos += nodeSize;
    return {
      type: { name: "paragraph" },
      textContent: p.text,
      nodeSize,
      from,
      descendants: vi.fn((cb: (child: Record<string, unknown>) => boolean) => {
        if (p.text) {
          cb({ isText: true, text: p.text });
        }
        return true;
      }),
    };
  });

  return {
    state: {
      doc: {
        descendants: vi.fn((cb: (node: Record<string, unknown>, pos: number) => boolean | void) => {
          let currentPos = 0;
          for (const para of paraNodes) {
            // In ProseMirror, returning false means "don't descend into children"
            // but iteration continues to next sibling. Our paragraphs are leaf-level
            // so we always continue.
            cb(para, currentPos);
            currentPos += para.nodeSize;
          }
        }),
      },
      tr: mockTr,
    },
    view: { dispatch: vi.fn() },
    chain: vi.fn(() => mockChain),
    mockTr,
  };
}

describe("paragraphHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateBaseRevision).mockReturnValue(null);
    vi.mocked(isAutoApproveEnabled).mockReturnValue(false);
  });

  describe("handleParagraphRead", () => {
    it("reads paragraph by index", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor([{ text: "first" }, { text: "second" }]) as never);

      await handleParagraphRead("req-1", { target: { index: 1 } });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          index: 1,
          content: "second",
        }),
      });
    });

    it("reads paragraph by containing text", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor([{ text: "hello world" }, { text: "foo bar" }]) as never);

      await handleParagraphRead("req-1", { target: { containing: "foo" } });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          index: 1,
          content: "foo bar",
        }),
      });
    });

    it("returns not_found for missing paragraph", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor([{ text: "hello" }]) as never);

      await handleParagraphRead("req-1", { target: { index: 99 } });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Paragraph not found",
        data: { code: "not_found" },
      });
    });

    it("returns error when target missing index and containing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleParagraphRead("req-1", { target: {} });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "target must specify index or containing",
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleParagraphRead("req-1", { target: { index: 0 } });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleParagraphWrite", () => {
    it("returns revision conflict error", async () => {
      vi.mocked(validateBaseRevision).mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleParagraphWrite("req-1", {
        baseRevision: "rev-old",
        target: { index: 0 },
        operation: "replace",
        content: "new text",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Revision conflict",
        data: { code: "conflict", currentRevision: "rev-current" },
      });
    });

    it("creates suggestion for replace operation", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor([{ text: "old text" }]) as never);

      const addSuggestion = vi.fn(() => "sug-replace");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({ addSuggestion } as never);

      await handleParagraphWrite("req-1", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "replace",
        content: "new text",
      });

      expect(addSuggestion).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          applied: false,
          suggestionId: "sug-replace",
        }),
      });
    });

    it("returns error when content missing for non-delete operation", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleParagraphWrite("req-1", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "replace",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "content is required for non-delete operations",
      });
    });

    it("applies delete directly when auto-approve on", async () => {
      vi.mocked(isAutoApproveEnabled).mockReturnValue(true);
      const editor = createMockEditor([{ text: "delete me" }]);
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleParagraphWrite("req-1", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "delete",
        mode: "apply",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          applied: true,
          newRevision: "rev-new",
        }),
      });
    });

    it("returns error for unknown operation", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleParagraphWrite("req-1", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "unknown",
        content: "text",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Unknown operation: unknown",
      });
    });
  });
});
