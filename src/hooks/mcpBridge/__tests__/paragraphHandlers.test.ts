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
        error: 'Invalid operation: "unknown". Must be one of: replace, append, prepend, delete',
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

    it("returns error when target is missing", async () => {
      mockGetEditor.mockReturnValue(createMockEditor(["text"]));

      await handleParagraphWrite("req-11", {
        baseRevision: "rev-1",
        operation: "replace",
        content: "new",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-11",
        success: false,
        error: "Missing or invalid 'target' (expected object, got undefined)",
      });
    });

    it("returns error when target has no index or containing", async () => {
      mockGetEditor.mockReturnValue(createMockEditor(["text"]));

      await handleParagraphWrite("req-12", {
        baseRevision: "rev-1",
        target: {},
        operation: "replace",
        content: "new",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-12",
        success: false,
        error: "target must specify index or containing",
      });
    });

    it("allows delete operation without content", async () => {
      const editor = createMockEditor(["text to delete"]);
      mockGetEditor.mockReturnValue(editor);
      mockIsAutoApproveEnabled.mockReturnValue(true);

      await handleParagraphWrite("req-13", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "delete",
        mode: "apply",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.message).toContain("deleted");
    });

    it("creates suggestion in suggest mode for replace", async () => {
      const editor = createMockEditor(["original text"]);
      mockGetEditor.mockReturnValue(editor);
      mockIsAutoApproveEnabled.mockReturnValue(false);

      await handleParagraphWrite("req-14", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "replace",
        content: "new text",
        mode: "suggest",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.applied).toBe(false);
      expect(call.data.suggestionId).toBeDefined();
    });

    it("creates suggestion for append operation", async () => {
      const editor = createMockEditor(["hello"]);
      mockGetEditor.mockReturnValue(editor);
      mockIsAutoApproveEnabled.mockReturnValue(false);

      await handleParagraphWrite("req-15", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "append",
        content: " world",
        mode: "suggest",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.message).toContain("append");
    });

    it("creates suggestion for prepend operation", async () => {
      const editor = createMockEditor(["world"]);
      mockGetEditor.mockReturnValue(editor);
      mockIsAutoApproveEnabled.mockReturnValue(false);

      await handleParagraphWrite("req-16", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "prepend",
        content: "hello ",
        mode: "suggest",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.message).toContain("prepend");
    });

    it("creates suggestion for delete operation", async () => {
      const editor = createMockEditor(["to delete"]);
      mockGetEditor.mockReturnValue(editor);
      mockIsAutoApproveEnabled.mockReturnValue(false);

      await handleParagraphWrite("req-17", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "delete",
        mode: "suggest",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.message).toContain("delete");
    });

    it("applies replace directly in apply mode", async () => {
      const editor = createMockEditor(["old text"]);
      // Add tr and replaceRange to mock editor
      (editor as Record<string, unknown>).state = {
        ...editor.state,
        tr: {
          replaceRange: vi.fn().mockReturnThis(),
        },
      };
      mockGetEditor.mockReturnValue(editor);
      mockIsAutoApproveEnabled.mockReturnValue(true);

      await handleParagraphWrite("req-18", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "replace",
        content: "new text",
        mode: "apply",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.applied).toBe(true);
      expect(call.data.message).toContain("replaced");
    });

    it("applies append directly in apply mode", async () => {
      const editor = createMockEditor(["hello"]);
      (editor as Record<string, unknown>).state = {
        ...editor.state,
        tr: {
          replaceRange: vi.fn().mockReturnThis(),
        },
      };
      mockGetEditor.mockReturnValue(editor);
      mockIsAutoApproveEnabled.mockReturnValue(true);

      await handleParagraphWrite("req-19", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "append",
        content: " world",
        mode: "apply",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.message).toContain("appended to");
    });

    it("applies prepend directly in apply mode", async () => {
      const editor = createMockEditor(["world"]);
      (editor as Record<string, unknown>).state = {
        ...editor.state,
        tr: {
          replaceRange: vi.fn().mockReturnThis(),
        },
      };
      mockGetEditor.mockReturnValue(editor);
      mockIsAutoApproveEnabled.mockReturnValue(true);

      await handleParagraphWrite("req-20", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "prepend",
        content: "hello ",
        mode: "apply",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.message).toContain("prepended to");
    });

    it("finds paragraph by containing text", async () => {
      const editor = createMockEditor(["first", "target text", "third"]);
      mockGetEditor.mockReturnValue(editor);
      mockIsAutoApproveEnabled.mockReturnValue(false);

      await handleParagraphWrite("req-21", {
        baseRevision: "rev-1",
        target: { containing: "target" },
        operation: "replace",
        content: "replaced",
        mode: "suggest",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
    });
  });

  describe("handleParagraphRead — with context", () => {
    it("includes context when requested", async () => {
      const editor = createMockEditor(["Before", "Target", "After"]);
      mockGetEditor.mockReturnValue(editor);

      await handleParagraphRead("req-30", {
        target: { index: 1 },
        includeContext: true,
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.context).toBeDefined();
      expect(call.data.context.before).toBe("Before");
      expect(call.data.context.after).toBe("After");
    });

    it("includes word and char counts", async () => {
      const editor = createMockEditor(["Hello world"]);
      mockGetEditor.mockReturnValue(editor);

      await handleParagraphRead("req-31", {
        target: { index: 0 },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.wordCount).toBe(2);
      expect(call.data.charCount).toBe(11);
    });

    it("returns not_found for non-matching containing text", async () => {
      const editor = createMockEditor(["First", "Second"]);
      mockGetEditor.mockReturnValue(editor);

      await handleParagraphRead("req-32", {
        target: { containing: "nonexistent" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data.code).toBe("not_found");
    });

    it("returns no target missing error", async () => {
      mockGetEditor.mockReturnValue(createMockEditor(["text"]));

      await handleParagraphRead("req-33", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-33",
        success: false,
        error: "Missing or invalid 'target' (expected object, got undefined)",
      });
    });

    it("handles context at first paragraph (no before)", async () => {
      const editor = createMockEditor(["First", "Second"]);
      mockGetEditor.mockReturnValue(editor);

      await handleParagraphRead("req-ctx-first", {
        target: { index: 0 },
        includeContext: true,
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.context.before).toBeUndefined();
      expect(call.data.context.after).toBe("Second");
    });

    it("handles context at last paragraph (no after)", async () => {
      const editor = createMockEditor(["First", "Last"]);
      mockGetEditor.mockReturnValue(editor);

      await handleParagraphRead("req-ctx-last", {
        target: { index: 1 },
        includeContext: true,
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.context.before).toBe("First");
      expect(call.data.context.after).toBeUndefined();
    });

    it("returns null from findParagraph when target has neither index nor containing", async () => {
      // target: {} triggers the "target must specify index or containing" error
      // but a target with both missing also exercises findParagraph returning null
      mockGetEditor.mockReturnValue(createMockEditor(["text"]));

      await handleParagraphRead("req-fp-null", { target: {} });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-fp-null",
        success: false,
        error: "target must specify index or containing",
      });
    });
  });

  // ── dryRun mode ──

  describe("handleParagraphWrite — dryRun mode", () => {
    it("returns preview without applying for replace", async () => {
      const editor = createMockEditor(["old text"]);
      mockGetEditor.mockReturnValue(editor);

      await handleParagraphWrite("req-dry-1", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "replace",
        content: "new text",
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.applied).toBe(false);
      expect(call.data.preview).toBeDefined();
      expect(call.data.preview.operation).toBe("replace");
      expect(call.data.preview.newContent).toBe("new text");
      expect(call.data.preview.originalContent).toBe("old text");
      expect(call.data.newRevision).toBe("rev-new");
    });

    it("returns preview without applying for delete", async () => {
      const editor = createMockEditor(["to delete"]);
      mockGetEditor.mockReturnValue(editor);

      await handleParagraphWrite("req-dry-2", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "delete",
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.applied).toBe(false);
      expect(call.data.preview.operation).toBe("delete");
      expect(call.data.preview.newContent).toBe("");
    });

    it("does not dispatch to editor in dryRun", async () => {
      const editor = createMockEditor(["text"]);
      mockGetEditor.mockReturnValue(editor);

      await handleParagraphWrite("req-dry-3", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "replace",
        content: "new",
        mode: "dryRun",
      });

      expect(editor.view.dispatch).not.toHaveBeenCalled();
      expect(editor.chain).not.toHaveBeenCalled();
    });
  });

  // ── non-Error catch branches ──

  describe("handleParagraphRead — non-Error catch branch", () => {
    it("handles non-Error thrown value", async () => {
      mockGetEditor.mockImplementation(() => {
        throw 42;
      });

      await handleParagraphRead("req-ne-read", { target: { index: 0 } });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ne-read",
        success: false,
        error: "42",
      });
    });
  });

  describe("handleParagraphWrite — non-Error catch branch", () => {
    it("handles non-Error thrown value", async () => {
      mockGetEditor.mockImplementation(() => {
        throw "write error";
      });

      await handleParagraphWrite("req-ne-write", {
        baseRevision: "rev-1",
        target: { index: 0 },
        operation: "replace",
        content: "new",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ne-write",
        success: false,
        error: "write error",
      });
    });
  });

  describe("handleParagraphRead — countWords edge cases", () => {
    it("counts words correctly for empty string", async () => {
      const editor = createMockEditor([""]);
      mockGetEditor.mockReturnValue(editor);

      await handleParagraphRead("req-cw-empty", {
        target: { index: 0 },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.wordCount).toBe(0);
      expect(call.data.charCount).toBe(0);
    });
  });
});
