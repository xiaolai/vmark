/**
 * MCP Bridge - Suggestion Handler Tests
 *
 * Tests for document modification handlers with autoApproveEdits setting.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleSetContent,
  handleInsertAtCursorWithSuggestion,
  handleInsertAtPositionWithSuggestion,
  handleDocumentReplaceWithSuggestion,
  handleSelectionReplaceWithSuggestion,
  handleSelectionDeleteWithSuggestion,
} from "./suggestionHandlers";

// Mock utils
vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
  isAutoApproveEnabled: vi.fn(() => false),
}));

// Mock aiSuggestionStore
vi.mock("@/stores/aiSuggestionStore", () => ({
  useAiSuggestionStore: {
    getState: vi.fn(() => ({
      addSuggestion: vi.fn(() => "suggestion-123"),
    })),
  },
}));

// Mock markdownPaste plugin
vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  createMarkdownPasteSlice: vi.fn(() => ({
    content: { size: 10 },
  })),
}));

import { respond, getEditor, isAutoApproveEnabled } from "./utils";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";

/**
 * Create a mock editor with necessary methods.
 */
function createMockEditor(options: {
  selectionFrom?: number;
  selectionTo?: number;
  docSize?: number;
  docText?: string;
  textContent?: string;
} = {}) {
  const { selectionFrom = 0, selectionTo = 0, docSize = 100, docText = "hello world", textContent } = options;
  // textContent defaults to docText if not specified
  const docTextContent = textContent ?? docText;

  const mockChain = {
    setTextSelection: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    deleteSelection: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };

  const mockTr = {
    replaceSelection: vi.fn().mockReturnThis(),
    replaceWith: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    replaceRange: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  return {
    state: {
      selection: { from: selectionFrom, to: selectionTo },
      doc: {
        content: { size: docSize },
        textContent: docTextContent,
        textBetween: vi.fn(() => docText),
        descendants: vi.fn((callback: (node: { isText: boolean; text?: string }, pos: number) => boolean | void) => {
          // Simulate a single text node with the doc text
          callback({ isText: true, text: docText }, 0);
        }),
      },
      tr: mockTr,
    },
    view: {
      dispatch: vi.fn(),
    },
    commands: {
      insertContent: vi.fn(),
    },
    chain: vi.fn(() => mockChain),
    mockTr, // expose for assertions
  };
}

/**
 * Helper to set autoApproveEdits setting.
 */
function setAutoApprove(enabled: boolean) {
  vi.mocked(isAutoApproveEnabled).mockReturnValue(enabled);
}

describe("suggestionHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: autoApproveEdits OFF
    setAutoApprove(false);
  });

  describe("handleSetContent", () => {
    it("returns error when document is not empty", async () => {
      const editor = createMockEditor({ textContent: "existing content" });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleSetContent("req-1", { content: "new content" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error:
          "document.setContent is only allowed on empty documents. " +
          "Use document.insertAtCursor, document.replace, or selection.replace for non-empty documents.",
      });
    });

    it("allows setContent when document is empty", async () => {
      const editor = createMockEditor({ textContent: "", docSize: 1 });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleSetContent("req-1", { content: "# Hello World" });

      expect(editor.view.dispatch).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { message: "Document content set successfully." },
      });
    });

    it("allows setContent when document has only whitespace", async () => {
      const editor = createMockEditor({ textContent: "   \n  \t  ", docSize: 10 });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleSetContent("req-1", { content: "# New Content" });

      expect(editor.view.dispatch).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { message: "Document content set successfully." },
      });
    });
  });

  describe("handleInsertAtCursorWithSuggestion", () => {
    it("creates suggestion when autoApproveEdits is OFF", async () => {
      const editor = createMockEditor({ selectionFrom: 5 });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      const addSuggestion = vi.fn(() => "suggestion-abc");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({
        addSuggestion,
      } as unknown as ReturnType<typeof useAiSuggestionStore.getState>);

      await handleInsertAtCursorWithSuggestion("req-1", { text: "inserted text" });

      expect(addSuggestion).toHaveBeenCalledWith({
        type: "insert",
        from: 5,
        to: 5,
        newContent: "inserted text",
      });
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: {
          suggestionId: "suggestion-abc",
          message: "Content staged as suggestion. Awaiting user approval.",
          position: 5,
        },
      });
    });

    it("applies directly when autoApproveEdits is ON", async () => {
      setAutoApprove(true);
      const editor = createMockEditor({ selectionFrom: 5 });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertAtCursorWithSuggestion("req-2", { text: "inserted text" });

      // New implementation uses createMarkdownPasteSlice + tr.replaceSelection
      expect(editor.mockTr.replaceSelection).toHaveBeenCalled();
      expect(editor.view.dispatch).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-2",
        success: true,
        data: {
          message: "Content inserted (auto-approved).",
          position: 5,
        },
      });
    });

    it("returns error when no editor available", async () => {
      vi.mocked(getEditor).mockReturnValue(null);

      await handleInsertAtCursorWithSuggestion("req-3", { text: "test" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-3",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when text is not a string", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertAtCursorWithSuggestion("req-4", { text: 123 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-4",
        success: false,
        error: "text must be a string",
      });
    });
  });

  describe("handleInsertAtPositionWithSuggestion", () => {
    it("creates suggestion when autoApproveEdits is OFF", async () => {
      const editor = createMockEditor({ docSize: 100 });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      const addSuggestion = vi.fn(() => "suggestion-xyz");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({
        addSuggestion,
      } as unknown as ReturnType<typeof useAiSuggestionStore.getState>);

      await handleInsertAtPositionWithSuggestion("req-1", { text: "new text", position: 10 });

      expect(addSuggestion).toHaveBeenCalledWith({
        type: "insert",
        from: 10,
        to: 10,
        newContent: "new text",
      });
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: {
          suggestionId: "suggestion-xyz",
          message: "Content staged as suggestion. Awaiting user approval.",
          position: 10,
        },
      });
    });

    it("applies directly when autoApproveEdits is ON", async () => {
      setAutoApprove(true);
      const editor = createMockEditor({ docSize: 100 });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertAtPositionWithSuggestion("req-2", { text: "new text", position: 10 });

      // New implementation uses createMarkdownPasteSlice + tr.replaceRange
      expect(editor.mockTr.replaceRange).toHaveBeenCalledWith(10, 10, expect.anything());
      expect(editor.view.dispatch).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-2",
        success: true,
        data: {
          message: "Content inserted (auto-approved).",
          position: 10,
        },
      });
    });

    it("returns error for invalid position", async () => {
      const editor = createMockEditor({ docSize: 50 });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertAtPositionWithSuggestion("req-3", { text: "test", position: 100 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-3",
        success: false,
        error: "Invalid position: 100 (document size: 50)",
      });
    });

    it("returns error when position is not a number", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertAtPositionWithSuggestion("req-4", { text: "test", position: "10" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-4",
        success: false,
        error: "position must be a number",
      });
    });
  });

  describe("handleDocumentReplaceWithSuggestion", () => {
    it("creates suggestions when autoApproveEdits is OFF and matches found", async () => {
      const editor = createMockEditor({ docText: "hello world" });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      const addSuggestion = vi.fn(() => "suggestion-replace");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({
        addSuggestion,
      } as unknown as ReturnType<typeof useAiSuggestionStore.getState>);

      await handleDocumentReplaceWithSuggestion("req-1", {
        search: "hello",
        replace: "hi",
        all: false,
      });

      expect(addSuggestion).toHaveBeenCalledWith({
        type: "replace",
        from: 0,
        to: 5,
        newContent: "hi",
        originalContent: "hello",
      });
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: {
          suggestionIds: ["suggestion-replace"],
          count: 1,
          message: "1 replacement(s) staged as suggestions. Awaiting user approval.",
        },
      });
    });

    it("applies directly when autoApproveEdits is ON", async () => {
      setAutoApprove(true);
      const editor = createMockEditor({ docText: "hello world" });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleDocumentReplaceWithSuggestion("req-2", {
        search: "hello",
        replace: "hi",
        all: false,
      });

      // New implementation uses createMarkdownPasteSlice + tr.replaceRange
      expect(editor.mockTr.replaceRange).toHaveBeenCalled();
      expect(editor.view.dispatch).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-2",
        success: true,
        data: {
          count: 1,
          message: "1 replacement(s) applied (auto-approved).",
        },
      });
    });

    it("returns no matches when search text not found", async () => {
      const editor = createMockEditor({ docText: "hello world" });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleDocumentReplaceWithSuggestion("req-3", {
        search: "xyz",
        replace: "abc",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-3",
        success: true,
        data: { count: 0, message: "No matches found" },
      });
    });

    it("returns error when search is not a string", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleDocumentReplaceWithSuggestion("req-4", { search: 123, replace: "abc" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-4",
        success: false,
        error: "search must be a string",
      });
    });
  });

  describe("handleSelectionReplaceWithSuggestion", () => {
    it("creates suggestion when autoApproveEdits is OFF and text is selected", async () => {
      const editor = createMockEditor({
        selectionFrom: 0,
        selectionTo: 5,
        docText: "hello",
      });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      const addSuggestion = vi.fn(() => "suggestion-sel");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({
        addSuggestion,
      } as unknown as ReturnType<typeof useAiSuggestionStore.getState>);

      await handleSelectionReplaceWithSuggestion("req-1", { text: "hi" });

      expect(addSuggestion).toHaveBeenCalledWith({
        type: "replace",
        from: 0,
        to: 5,
        newContent: "hi",
        originalContent: "hello",
      });
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: {
          suggestionId: "suggestion-sel",
          message: "Replacement staged as suggestion. Awaiting user approval.",
          range: { from: 0, to: 5 },
          originalContent: "hello",
        },
      });
    });

    it("applies directly when autoApproveEdits is ON", async () => {
      setAutoApprove(true);
      const editor = createMockEditor({
        selectionFrom: 0,
        selectionTo: 5,
        docText: "hello",
      });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleSelectionReplaceWithSuggestion("req-2", { text: "hi" });

      // New implementation uses createMarkdownPasteSlice + tr.replaceRange
      expect(editor.mockTr.replaceRange).toHaveBeenCalledWith(0, 5, expect.anything());
      expect(editor.view.dispatch).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-2",
        success: true,
        data: {
          message: "Selection replaced (auto-approved).",
          range: { from: 0, to: 5 },
          originalContent: "hello",
        },
      });
    });

    it("delegates to insertAtCursor when no selection", async () => {
      const editor = createMockEditor({
        selectionFrom: 5,
        selectionTo: 5, // No selection (cursor only)
      });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      const addSuggestion = vi.fn(() => "suggestion-insert");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({
        addSuggestion,
      } as unknown as ReturnType<typeof useAiSuggestionStore.getState>);

      await handleSelectionReplaceWithSuggestion("req-3", { text: "inserted" });

      // Should create an insert suggestion, not replace
      expect(addSuggestion).toHaveBeenCalledWith({
        type: "insert",
        from: 5,
        to: 5,
        newContent: "inserted",
      });
    });
  });

  describe("handleSelectionDeleteWithSuggestion", () => {
    it("creates delete suggestion when autoApproveEdits is OFF", async () => {
      const editor = createMockEditor({
        selectionFrom: 0,
        selectionTo: 5,
        docText: "hello",
      });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      const addSuggestion = vi.fn(() => "suggestion-del");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({
        addSuggestion,
      } as unknown as ReturnType<typeof useAiSuggestionStore.getState>);

      await handleSelectionDeleteWithSuggestion("req-1");

      expect(addSuggestion).toHaveBeenCalledWith({
        type: "delete",
        from: 0,
        to: 5,
        originalContent: "hello",
      });
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: {
          suggestionId: "suggestion-del",
          message: "Content marked for deletion. Awaiting user approval.",
          range: { from: 0, to: 5 },
          content: "hello",
        },
      });
    });

    it("deletes directly when autoApproveEdits is ON", async () => {
      setAutoApprove(true);
      const editor = createMockEditor({
        selectionFrom: 0,
        selectionTo: 5,
        docText: "hello",
      });
      const mockChain = editor.chain();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleSelectionDeleteWithSuggestion("req-2");

      expect(editor.chain).toHaveBeenCalled();
      expect(mockChain.setTextSelection).toHaveBeenCalledWith({ from: 0, to: 5 });
      expect(mockChain.deleteSelection).toHaveBeenCalled();
      expect(mockChain.run).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-2",
        success: true,
        data: {
          message: "Selection deleted (auto-approved).",
          range: { from: 0, to: 5 },
          content: "hello",
        },
      });
    });

    it("returns error when no text is selected", async () => {
      const editor = createMockEditor({
        selectionFrom: 5,
        selectionTo: 5, // No selection
      });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleSelectionDeleteWithSuggestion("req-3");

      expect(respond).toHaveBeenCalledWith({
        id: "req-3",
        success: false,
        error: "No text selected",
      });
    });
  });
});
