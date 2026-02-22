/**
 * Tests for paragraphHandlers — paragraph.read and paragraph.write.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
const mockIsAutoApproveEnabled = vi.fn().mockReturnValue(true);
const mockGetActiveTabId = vi.fn().mockReturnValue("tab-1");
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
  isAutoApproveEnabled: () => mockIsAutoApproveEnabled(),
  getActiveTabId: () => mockGetActiveTabId(),
}));

// Mock revision tracker
const mockValidateBaseRevision = vi.fn();
const mockGetCurrentRevision = vi.fn().mockReturnValue("rev-new");
vi.mock("../revisionTracker", () => ({
  validateBaseRevision: (...args: unknown[]) =>
    mockValidateBaseRevision(...args),
  getCurrentRevision: () => mockGetCurrentRevision(),
}));

// Mock suggestion store
vi.mock("@/stores/aiSuggestionStore", () => ({
  useAiSuggestionStore: {
    getState: () => ({
      addSuggestion: vi.fn().mockReturnValue("suggestion-1"),
    }),
  },
}));

// Mock markdown paste slice
vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  createMarkdownPasteSlice: vi.fn().mockReturnValue({ content: "mock" }),
}));

import {
  handleParagraphRead,
  handleParagraphWrite,
} from "../paragraphHandlers";

/** Create a mock editor with paragraphs. */
function createMockEditor(paragraphTexts: string[]) {
  const paragraphs = paragraphTexts.map((text, _i) => ({
    type: { name: "paragraph" },
    nodeSize: text.length + 2, // +2 for open/close tags
    isText: false,
    text: undefined,
    descendants: (cb: (child: unknown) => boolean) => {
      cb({ isText: true, text });
      return true;
    },
  }));

  let nextPos = 0;
  const posMap = paragraphs.map((p) => {
    const from = nextPos;
    nextPos += p.nodeSize;
    return { from, to: nextPos };
  });

  return {
    state: {
      doc: {
        descendants: (
          cb: (node: unknown, pos: number) => boolean | undefined
        ) => {
          for (let i = 0; i < paragraphs.length; i++) {
            // In ProseMirror, returning false from descendants means
            // "don't descend into children", not "stop iteration".
            cb(paragraphs[i], posMap[i].from);
          }
        },
      },
    },
    chain: vi.fn().mockReturnValue({
      focus: vi.fn().mockReturnThis(),
      setTextSelection: vi.fn().mockReturnThis(),
      deleteSelection: vi.fn().mockReturnThis(),
      run: vi.fn(),
    }),
    view: {
      dispatch: vi.fn(),
    },
  };
}

describe("paragraphHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateBaseRevision.mockReturnValue(null);
  });

  describe("handleParagraphRead", () => {
    it("reads paragraph by index", async () => {
      const editor = createMockEditor(["First", "Second", "Third"]);
      mockGetEditor.mockReturnValue(editor);

      await handleParagraphRead("req-1", {
        target: { index: 1 },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.content).toBe("Second");
      expect(call.data.index).toBe(1);
    });

    it("reads paragraph by content match", async () => {
      const editor = createMockEditor(["Hello world", "Goodbye world"]);
      mockGetEditor.mockReturnValue(editor);

      await handleParagraphRead("req-2", {
        target: { containing: "Goodbye" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.content).toBe("Goodbye world");
    });

    it("returns not_found for out-of-range index", async () => {
      const editor = createMockEditor(["Only paragraph"]);
      mockGetEditor.mockReturnValue(editor);

      await handleParagraphRead("req-3", {
        target: { index: 5 },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data.code).toBe("not_found");
    });

    it("returns error for invalid target", async () => {
      mockGetEditor.mockReturnValue(createMockEditor(["text"]));

      await handleParagraphRead("req-4", { target: {} });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-4",
        success: false,
        error: "target must specify index or containing",
      });
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleParagraphRead("req-5", {
        target: { index: 0 },
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleParagraphWrite", () => {
    it("returns revision conflict error", async () => {
      mockValidateBaseRevision.mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleParagraphWrite("req-6", {
        baseRevision: "rev-old",
        target: { index: 0 },
        operation: "replace",
        content: "new text",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data.code).toBe("conflict");
    });

    it("returns error when content missing for non-delete", async () => {
      mockGetEditor.mockReturnValue(createMockEditor(["text"]));

      await handleParagraphWrite("req-7", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "replace",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-7",
        success: false,
        error: "content is required for non-delete operations",
      });
    });

    it("returns not_found when paragraph doesn't exist", async () => {
      mockGetEditor.mockReturnValue(createMockEditor(["text"]));

      await handleParagraphWrite("req-8", {
        baseRevision: "rev-1",
        target: { index: 99 },
        operation: "replace",
        content: "new",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data.code).toBe("not_found");
    });

    it("returns error for unknown operation", async () => {
      mockGetEditor.mockReturnValue(createMockEditor(["text"]));

      await handleParagraphWrite("req-9", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "unknown",
        content: "x",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-9",
        success: false,
        error: "Unknown operation: unknown",
      });
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleParagraphWrite("req-10", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "replace",
        content: "new",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-10",
        success: false,
        error: "No active editor",
      });
    });
  });
});
