/**
 * MCP Bridge — Smart Insert Handler Tests
 *
 * Tests for smartInsert handler with various destinations.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleSmartInsert } from "./smartInsertHandlers";

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

function createMockEditor() {
  const mockTr = {
    replaceRange: vi.fn().mockReturnThis(),
  };

  return {
    state: {
      doc: {
        content: { size: 100 },
        descendants: vi.fn((cb: (node: Record<string, unknown>, pos: number) => boolean | void) => {
          // Simulate a paragraph at position 0 with nodeSize 15
          cb(
            {
              type: { name: "paragraph" },
              nodeSize: 15,
              descendants: vi.fn((innerCb: (child: Record<string, unknown>) => boolean) => {
                innerCb({ isText: true, text: "hello world" });
                return true;
              }),
            },
            0,
          );
        }),
        forEach: vi.fn((cb: (node: Record<string, unknown>, offset: number) => void) => {
          cb(
            {
              type: { name: "paragraph" },
              nodeSize: 15,
              attrs: {},
              textContent: "hello world",
            },
            0,
          );
        }),
      },
      tr: mockTr,
    },
    view: { dispatch: vi.fn() },
    mockTr,
  };
}

describe("smartInsertHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateBaseRevision).mockReturnValue(null);
    vi.mocked(isAutoApproveEnabled).mockReturnValue(false);
  });

  describe("validation", () => {
    it("returns revision conflict error", async () => {
      vi.mocked(validateBaseRevision).mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleSmartInsert("req-1", {
        baseRevision: "rev-old",
        destination: "end_of_document",
        content: "new content",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Revision conflict",
        data: { code: "conflict", currentRevision: "rev-current" },
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleSmartInsert("req-1", {
        baseRevision: "rev-1",
        destination: "end_of_document",
        content: "text",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when content missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleSmartInsert("req-1", {
        baseRevision: "rev-1",
        destination: "end_of_document",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "content is required",
      });
    });

    it("returns error when destination missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleSmartInsert("req-1", {
        baseRevision: "rev-1",
        content: "text",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "destination is required",
      });
    });
  });

  describe("destination: end_of_document", () => {
    it("creates suggestion at end of document", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      const addSuggestion = vi.fn(() => "sug-end");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({ addSuggestion } as never);

      await handleSmartInsert("req-1", {
        baseRevision: "rev-1",
        destination: "end_of_document",
        content: "appended text",
      });

      expect(addSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({ from: 100, to: 100 }),
      );
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          applied: false,
          insertPosition: 100,
        }),
      });
    });
  });

  describe("destination: start_of_document", () => {
    it("creates suggestion at start of document", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      const addSuggestion = vi.fn(() => "sug-start");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({ addSuggestion } as never);

      await handleSmartInsert("req-1", {
        baseRevision: "rev-1",
        destination: "start_of_document",
        content: "prepended text",
      });

      expect(addSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({ from: 0, to: 0 }),
      );
    });
  });

  describe("destination: after_paragraph (not found)", () => {
    it("returns not_found when paragraph index out of range", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleSmartInsert("req-1", {
        baseRevision: "rev-1",
        destination: { after_paragraph: 99 },
        content: "text",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Paragraph at index 99 not found",
        data: { code: "not_found" },
      });
    });
  });

  describe("apply mode", () => {
    it("applies insert directly when auto-approve enabled", async () => {
      vi.mocked(isAutoApproveEnabled).mockReturnValue(true);
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleSmartInsert("req-1", {
        baseRevision: "rev-1",
        destination: "end_of_document",
        content: "new content",
        mode: "apply",
      });

      expect(editor.mockTr.replaceRange).toHaveBeenCalled();
      expect(editor.view.dispatch).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          applied: true,
          newRevision: "rev-new",
        }),
      });
    });
  });
});
