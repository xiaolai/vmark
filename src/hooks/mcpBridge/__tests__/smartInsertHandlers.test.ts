/**
 * Tests for smartInsertHandlers — smartInsert at various destinations.
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
const mockAddSuggestion = vi.fn().mockReturnValue("suggestion-1");
vi.mock("@/stores/aiSuggestionStore", () => ({
  useAiSuggestionStore: {
    getState: () => ({
      addSuggestion: (...args: unknown[]) => mockAddSuggestion(...args),
    }),
  },
}));

// Mock markdown paste slice
vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  createMarkdownPasteSlice: vi.fn().mockReturnValue({ content: "mock" }),
}));

import { handleSmartInsert } from "../smartInsertHandlers";

/** Create mock editor with paragraphs and headings. */
function createMockEditor() {
  const paragraphs = [
    {
      type: { name: "paragraph" },
      nodeSize: 12,
      attrs: {},
      isText: false,
      descendants: (cb: (child: unknown) => boolean) => {
        cb({ isText: true, text: "First para" });
      },
    },
    {
      type: { name: "heading" },
      nodeSize: 10,
      attrs: { level: 2 },
      isText: false,
      descendants: (cb: (child: unknown) => boolean) => {
        cb({ isText: true, text: "Section A" });
      },
    },
    {
      type: { name: "paragraph" },
      nodeSize: 15,
      attrs: {},
      isText: false,
      descendants: (cb: (child: unknown) => boolean) => {
        cb({ isText: true, text: "Section content" });
      },
    },
  ];

  const docSize = paragraphs.reduce((sum, p) => sum + p.nodeSize, 0);

  return {
    state: {
      doc: {
        content: { size: docSize },
        descendants: (
          cb: (node: unknown, pos: number) => boolean | undefined
        ) => {
          let pos = 0;
          for (const p of paragraphs) {
            const result = cb(p, pos);
            if (result === false) break;
            pos += p.nodeSize;
          }
        },
        forEach: (cb: (node: unknown, offset: number) => void) => {
          let offset = 0;
          for (const p of paragraphs) {
            cb(p, offset);
            offset += p.nodeSize;
          }
        },
      },
      tr: {
        replaceRange: vi.fn().mockReturnThis(),
      },
    },
    view: {
      dispatch: vi.fn(),
    },
  };
}

describe("smartInsertHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateBaseRevision.mockReturnValue(null);
    mockIsAutoApproveEnabled.mockReturnValue(true);
  });

  it("returns revision conflict error", async () => {
    mockValidateBaseRevision.mockReturnValue({
      error: "Revision conflict",
      currentRevision: "rev-current",
    });

    await handleSmartInsert("req-1", {
      baseRevision: "rev-old",
      destination: "end_of_document",
      content: "new text",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.data.code).toBe("conflict");
  });

  it("returns error when no editor", async () => {
    mockGetEditor.mockReturnValue(null);

    await handleSmartInsert("req-2", {
      baseRevision: "rev-1",
      destination: "end_of_document",
      content: "text",
    });

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-2",
      success: false,
      error: "No active editor",
    });
  });

  it("returns error when content is missing", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());

    await handleSmartInsert("req-3", {
      baseRevision: "rev-1",
      destination: "end_of_document",
    });

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-3",
      success: false,
      error: "content is required",
    });
  });

  it("returns error when destination is missing", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());

    await handleSmartInsert("req-4", {
      baseRevision: "rev-1",
      content: "text",
    });

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-4",
      success: false,
      error: "destination is required",
    });
  });

  it("inserts at end of document", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-5", {
      baseRevision: "rev-1",
      destination: "end_of_document",
      content: "appended text",
      mode: "apply",
    });

    expect(editor.view.dispatch).toHaveBeenCalled();
    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.applied).toBe(true);
  });

  it("inserts at start of document", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-6", {
      baseRevision: "rev-1",
      destination: "start_of_document",
      content: "prepended text",
      mode: "apply",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.insertPosition).toBe(0);
  });

  it("inserts after paragraph by index", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-7", {
      baseRevision: "rev-1",
      destination: { after_paragraph: 0 },
      content: "after first",
      mode: "apply",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.applied).toBe(true);
  });

  it("returns not_found for out-of-range paragraph index", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-8", {
      baseRevision: "rev-1",
      destination: { after_paragraph: 99 },
      content: "text",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.data.code).toBe("not_found");
  });

  it("inserts after paragraph containing text", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-9", {
      baseRevision: "rev-1",
      destination: { after_paragraph_containing: "First" },
      content: "after match",
      mode: "apply",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
  });

  it("returns not_found for non-matching containing text", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-10", {
      baseRevision: "rev-1",
      destination: { after_paragraph_containing: "Nonexistent" },
      content: "text",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.data.code).toBe("not_found");
  });

  it("creates suggestion in suggest mode", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);
    mockIsAutoApproveEnabled.mockReturnValue(false);

    await handleSmartInsert("req-11", {
      baseRevision: "rev-1",
      destination: "end_of_document",
      content: "new text",
      mode: "suggest",
    });

    expect(mockAddSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "insert",
        tabId: "tab-1",
      })
    );
    const call = mockRespond.mock.calls[0][0];
    expect(call.data.applied).toBe(false);
    expect(call.data.suggestionId).toBeDefined();
  });
});
