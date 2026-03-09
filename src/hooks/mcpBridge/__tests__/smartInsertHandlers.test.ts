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
        scrollIntoView: vi.fn().mockReturnThis(),
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
      error: expect.stringContaining("'content'"),
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
      error: "Missing or invalid 'destination' (expected string or object, got undefined)",
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

  it("extracts text from paragraphs with mixed descendants (text + non-text)", async () => {
    // A paragraph with both text and non-text descendants exercises the
    // `if (child.isText)` false branch in extractText (line 42)
    const paragraphWithInline = {
      type: { name: "paragraph" },
      nodeSize: 20,
      attrs: {},
      isText: false,
      descendants: (cb: (child: unknown) => boolean) => {
        // Text child
        cb({ isText: true, text: "Hello " });
        // Non-text child (e.g., inline image or hard break)
        cb({ isText: false });
        // Another text child
        cb({ isText: true, text: "World" });
      },
    };
    const nodes = [paragraphWithInline];
    const docSize = nodes.reduce((sum, n) => sum + n.nodeSize, 0);

    const editor = {
      state: {
        doc: {
          content: { size: docSize },
          descendants: (
            cb: (node: unknown, pos: number) => boolean | undefined
          ) => {
            let pos = 0;
            for (const n of nodes) {
              const result = cb(n, pos);
              if (result === false) break;
              pos += n.nodeSize;
            }
          },
          forEach: (cb: (node: unknown, offset: number) => void) => {
            let offset = 0;
            for (const n of nodes) {
              cb(n, offset);
              offset += n.nodeSize;
            }
          },
        },
        tr: {
          replaceRange: vi.fn().mockReturnThis(),
          scrollIntoView: vi.fn().mockReturnThis(),
        },
      },
      view: { dispatch: vi.fn() },
    };
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-mixed", {
      baseRevision: "rev-1",
      destination: { after_paragraph_containing: "Hello" },
      content: "inserted",
      mode: "apply",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.applied).toBe(true);
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

  it("creates suggestion when auto-approve is disabled even with apply mode", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);
    mockIsAutoApproveEnabled.mockReturnValue(false);

    await handleSmartInsert("req-12", {
      baseRevision: "rev-1",
      destination: "end_of_document",
      content: "text",
      mode: "apply",
    });

    // When auto-approve is off, suggest mode is forced
    expect(mockAddSuggestion).toHaveBeenCalled();
    const call = mockRespond.mock.calls[0][0];
    expect(call.data.applied).toBe(false);
  });

  it("inserts after section heading", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-13", {
      baseRevision: "rev-1",
      destination: { after_section: "Section A" },
      content: "after section",
      mode: "apply",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.applied).toBe(true);
  });

  it("returns not_found for non-matching section heading", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-14", {
      baseRevision: "rev-1",
      destination: { after_section: "Nonexistent Section" },
      content: "text",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.data.code).toBe("not_found");
  });

  it("returns not_found for invalid destination type", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-15", {
      baseRevision: "rev-1",
      destination: { unknown_key: "value" },
      content: "text",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.error).toContain("Invalid destination");
  });

  it("returns error when baseRevision is missing", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());

    await handleSmartInsert("req-16", {
      destination: "end_of_document",
      content: "text",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.error).toContain("'baseRevision'");
  });

  it("includes insertPosition in response for apply mode", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-17", {
      baseRevision: "rev-1",
      destination: "start_of_document",
      content: "text",
      mode: "apply",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.insertPosition).toBe(0);
    expect(call.data.newRevision).toBe("rev-new");
  });

  it("includes insertPosition in response for suggest mode", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);
    mockIsAutoApproveEnabled.mockReturnValue(false);

    await handleSmartInsert("req-18", {
      baseRevision: "rev-1",
      destination: "end_of_document",
      content: "text",
      mode: "suggest",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.insertPosition).toBeDefined();
  });

  // ── dryRun mode ──

  it("returns preview without applying in dryRun mode", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-dry-1", {
      baseRevision: "rev-1",
      destination: "end_of_document",
      content: "dry run text",
      mode: "dryRun",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.applied).toBe(false);
    expect(call.data.preview).toBeDefined();
    expect(call.data.preview.insertPosition).toBeDefined();
    expect(call.data.preview.content).toContain("dry run text");
    expect(call.data.newRevision).toBe("rev-new");
    // Should NOT dispatch or create suggestions
    expect(editor.view.dispatch).not.toHaveBeenCalled();
    expect(mockAddSuggestion).not.toHaveBeenCalled();
  });

  it("dryRun returns preview for start_of_document", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-dry-2", {
      baseRevision: "rev-1",
      destination: "start_of_document",
      content: "prepend text",
      mode: "dryRun",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.applied).toBe(false);
    expect(call.data.preview.insertPosition).toBe(0);
  });

  it("handles non-Error thrown value in catch (String(error) branch)", async () => {
    mockGetEditor.mockImplementation(() => {
      throw "raw string error";
    });

    await handleSmartInsert("req-str-1", {
      baseRevision: "rev-1",
      destination: "end_of_document",
      content: "text",
    });

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-str-1",
      success: false,
      error: "raw string error",
    });
  });

  it("defaults mode to suggest when not specified", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);
    mockIsAutoApproveEnabled.mockReturnValue(false);

    await handleSmartInsert("req-default-mode", {
      baseRevision: "rev-1",
      destination: "end_of_document",
      content: "text",
      // mode intentionally omitted — defaults to "suggest"
    });

    expect(mockAddSuggestion).toHaveBeenCalled();
    const call = mockRespond.mock.calls[0][0];
    expect(call.data.applied).toBe(false);
  });

  it("section boundary stops at same-level heading and skips remaining nodes", async () => {
    // Create editor with heading, content, boundary heading, and a trailing paragraph.
    // The trailing paragraph exercises the sectionEnded early return (line 122).
    const nodes = [
      {
        type: { name: "heading" },
        nodeSize: 10,
        attrs: { level: 2 },
        isText: false,
        descendants: (cb: (child: unknown) => boolean) => {
          cb({ isText: true, text: "Target" });
        },
      },
      {
        type: { name: "paragraph" },
        nodeSize: 15,
        attrs: {},
        isText: false,
        descendants: (cb: (child: unknown) => boolean) => {
          cb({ isText: true, text: "Target content" });
        },
      },
      {
        type: { name: "heading" },
        nodeSize: 10,
        attrs: { level: 2 },
        isText: false,
        descendants: (cb: (child: unknown) => boolean) => {
          cb({ isText: true, text: "Next Section" });
        },
      },
      {
        type: { name: "paragraph" },
        nodeSize: 12,
        attrs: {},
        isText: false,
        descendants: (cb: (child: unknown) => boolean) => {
          cb({ isText: true, text: "Trailing" });
        },
      },
    ];

    const docSize = nodes.reduce((sum, n) => sum + n.nodeSize, 0);

    const editor = {
      state: {
        doc: {
          content: { size: docSize },
          descendants: (
            cb: (node: unknown, pos: number) => boolean | undefined
          ) => {
            let pos = 0;
            for (const n of nodes) {
              const result = cb(n, pos);
              if (result === false) break;
              pos += n.nodeSize;
            }
          },
          forEach: (cb: (node: unknown, offset: number) => void) => {
            let offset = 0;
            for (const n of nodes) {
              cb(n, offset);
              offset += n.nodeSize;
            }
          },
        },
        tr: {
          replaceRange: vi.fn().mockReturnThis(),
          scrollIntoView: vi.fn().mockReturnThis(),
        },
      },
      view: {
        dispatch: vi.fn(),
      },
    };
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-19", {
      baseRevision: "rev-1",
      destination: { after_section: "Target" },
      content: "after target section",
      mode: "apply",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    // Insert position should be at end of section (before next heading)
    expect(call.data.insertPosition).toBe(25); // 10 + 15
  });

  it("sub-heading within section does NOT stop the section", async () => {
    // H2 "Target" -> paragraph -> H3 sub-heading (should NOT end section) -> paragraph
    // This exercises the `headingLevel <= targetLevel` false branch (line 130)
    const nodes = [
      {
        type: { name: "heading" },
        nodeSize: 10,
        attrs: { level: 2 },
        isText: false,
        descendants: (cb: (child: unknown) => boolean) => {
          cb({ isText: true, text: "Target" });
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
      {
        type: { name: "heading" },
        nodeSize: 10,
        attrs: { level: 3 }, // Sub-heading — deeper, should NOT end section
        isText: false,
        descendants: (cb: (child: unknown) => boolean) => {
          cb({ isText: true, text: "Sub-section" });
        },
      },
      {
        type: { name: "paragraph" },
        nodeSize: 12,
        attrs: {},
        isText: false,
        descendants: (cb: (child: unknown) => boolean) => {
          cb({ isText: true, text: "Sub-content" });
        },
      },
    ];

    const docSize = nodes.reduce((sum, n) => sum + n.nodeSize, 0);

    const editor = {
      state: {
        doc: {
          content: { size: docSize },
          descendants: (
            cb: (node: unknown, pos: number) => boolean | undefined
          ) => {
            let pos = 0;
            for (const n of nodes) {
              const result = cb(n, pos);
              if (result === false) break;
              pos += n.nodeSize;
            }
          },
          forEach: (cb: (node: unknown, offset: number) => void) => {
            let offset = 0;
            for (const n of nodes) {
              cb(n, offset);
              offset += n.nodeSize;
            }
          },
        },
        tr: {
          replaceRange: vi.fn().mockReturnThis(),
          scrollIntoView: vi.fn().mockReturnThis(),
        },
      },
      view: {
        dispatch: vi.fn(),
      },
    };
    mockGetEditor.mockReturnValue(editor);

    await handleSmartInsert("req-20", {
      baseRevision: "rev-1",
      destination: { after_section: "Target" },
      content: "after entire section",
      mode: "apply",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    // Insert position should be at end of all section content (10 + 15 + 10 + 12 = 47)
    expect(call.data.insertPosition).toBe(47);
  });
});
