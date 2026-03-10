/**
 * Tests for replaceAnchoredHandler — replace_text_anchored with
 * context-based matching and similarity scoring.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
const mockIsAutoApproveEnabled = vi.fn().mockReturnValue(true);
const mockGetActiveTabId = vi.fn().mockReturnValue("tab-1");
const mockFindTextMatches = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
  isAutoApproveEnabled: () => mockIsAutoApproveEnabled(),
  getActiveTabId: () => mockGetActiveTabId(),
  findTextMatches: (...args: unknown[]) => mockFindTextMatches(...args),
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
  createMarkdownPasteSlice: vi.fn().mockReturnValue({ content: "mock-slice" }),
}));

import { handleReplaceAnchored } from "../replaceAnchoredHandler";

function createMockEditor() {
  const tr = {
    replaceRange: vi.fn().mockReturnThis(),
  };
  return {
    state: {
      doc: { textContent: "Hello world" },
      tr,
    },
    view: {
      dispatch: vi.fn(),
    },
  };
}

describe("replaceAnchoredHandler", () => {
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

    await handleReplaceAnchored("req-1", {
      baseRevision: "rev-old",
      anchor: { text: "Hello", beforeContext: "", afterContext: "", maxDistance: 100 },
      replacement: "Hi",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.data.code).toBe("conflict");
  });

  it("returns error when no editor", async () => {
    mockGetEditor.mockReturnValue(null);

    await handleReplaceAnchored("req-2", {
      baseRevision: "rev-1",
      anchor: { text: "Hello", beforeContext: "", afterContext: "", maxDistance: 100 },
      replacement: "Hi",
    });

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-2",
      success: false,
      error: "No active editor",
    });
  });

  it("returns error when anchor.text is missing", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());

    await handleReplaceAnchored("req-3", {
      baseRevision: "rev-1",
      anchor: {},
      replacement: "Hi",
    });

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-3",
      success: false,
      error: "Missing required field 'anchor.text'",
    });
  });

  it("returns not_found when no text matches exist", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());
    mockFindTextMatches.mockReturnValue([]);

    await handleReplaceAnchored("req-4", {
      baseRevision: "rev-1",
      anchor: {
        text: "xyz",
        beforeContext: "abc",
        afterContext: "def",
        maxDistance: 100,
      },
      replacement: "Hi",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.success).toBe(false);
    expect(call.data.error).toBe("not_found");
  });

  it("returns not_found when matches exist but context similarity is too low", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());
    // Match with completely different context
    mockFindTextMatches.mockReturnValue([
      {
        from: 0,
        to: 5,
        nodeId: "p-0",
        context: { before: "zzzzz", after: "yyyyy" },
      },
    ]);

    await handleReplaceAnchored("req-5", {
      baseRevision: "rev-1",
      anchor: {
        text: "Hello",
        beforeContext: "abcdefgh",
        afterContext: "ijklmnop",
        maxDistance: 100,
      },
      replacement: "Hi",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.data.success).toBe(false);
    expect(call.data.error).toBe("not_found");
  });

  it("returns ambiguous_target when multiple candidates match", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());
    // Two matches with identical high-similarity context
    mockFindTextMatches.mockReturnValue([
      {
        from: 0,
        to: 5,
        nodeId: "p-0",
        context: { before: "same context", after: "same after" },
      },
      {
        from: 20,
        to: 25,
        nodeId: "p-1",
        context: { before: "same context", after: "same after" },
      },
    ]);

    await handleReplaceAnchored("req-6", {
      baseRevision: "rev-1",
      anchor: {
        text: "Hello",
        beforeContext: "same context",
        afterContext: "same after",
        maxDistance: 100,
      },
      replacement: "Hi",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.data.success).toBe(false);
    expect(call.data.error).toBe("ambiguous_target");
    expect(call.data.matchCount).toBe(2);
  });

  it("applies replacement when exactly one candidate matches", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);
    mockFindTextMatches.mockReturnValue([
      {
        from: 0,
        to: 5,
        nodeId: "p-0",
        context: { before: "exact match", after: "exact after" },
      },
    ]);

    await handleReplaceAnchored("req-7", {
      baseRevision: "rev-1",
      anchor: {
        text: "Hello",
        beforeContext: "exact match",
        afterContext: "exact after",
        maxDistance: 100,
      },
      replacement: "Hi",
    });

    expect(editor.view.dispatch).toHaveBeenCalledTimes(1);
    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.success).toBe(true);
    expect(call.data.appliedCount).toBe(1);
    expect(call.data.newRevision).toBe("rev-new");
  });

  it("returns preview for dryRun mode", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());
    mockFindTextMatches.mockReturnValue([
      {
        from: 0,
        to: 5,
        nodeId: "p-0",
        context: { before: "exact", after: "match" },
      },
    ]);

    await handleReplaceAnchored("req-8", {
      baseRevision: "rev-1",
      anchor: {
        text: "Hello",
        beforeContext: "exact",
        afterContext: "match",
        maxDistance: 100,
      },
      replacement: "Hi",
      mode: "dryRun",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.isDryRun).toBe(true);
    expect(call.data.similarity).toBeGreaterThan(0);
  });

  it("creates suggestion in suggest mode", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());
    mockIsAutoApproveEnabled.mockReturnValue(false);
    mockFindTextMatches.mockReturnValue([
      {
        from: 0,
        to: 5,
        nodeId: "p-0",
        context: { before: "context", after: "after" },
      },
    ]);

    await handleReplaceAnchored("req-9", {
      baseRevision: "rev-1",
      anchor: {
        text: "Hello",
        beforeContext: "context",
        afterContext: "after",
        maxDistance: 100,
      },
      replacement: "Hi",
      mode: "suggest",
    });

    expect(mockAddSuggestion).toHaveBeenCalledWith({
      tabId: "tab-1",
      type: "replace",
      from: 0,
      to: 5,
      newContent: "Hi",
      originalContent: "Hello",
    });
    const call = mockRespond.mock.calls[0][0];
    expect(call.data.suggestionIds).toHaveLength(1);
  });

  it("handles non-Error thrown value in catch branch", async () => {
    mockGetEditor.mockImplementation(() => {
      throw "raw string error";
    });

    await handleReplaceAnchored("req-ne", {
      baseRevision: "rev-1",
      anchor: { text: "Hello", beforeContext: "", afterContext: "", maxDistance: 100 },
      replacement: "Hi",
    });

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-ne",
      success: false,
      error: "raw string error",
    });
  });

  it("filters candidates that exceed maxDistance", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());
    // Context length exceeds maxDistance
    mockFindTextMatches.mockReturnValue([
      {
        from: 0,
        to: 5,
        nodeId: "p-0",
        context: { before: "a".repeat(50), after: "b".repeat(50) },
      },
    ]);

    await handleReplaceAnchored("req-maxdist", {
      baseRevision: "rev-1",
      anchor: {
        text: "Hello",
        beforeContext: "a".repeat(50),
        afterContext: "b".repeat(50),
        maxDistance: 10,
      },
      replacement: "Hi",
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.data.error).toBe("not_found");
  });

  it("uses default maxDistance of Infinity when not specified", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());
    // Match with high similarity context
    mockFindTextMatches.mockReturnValue([
      {
        from: 0,
        to: 5,
        nodeId: "p-0",
        context: { before: "same context", after: "same after" },
      },
    ]);

    await handleReplaceAnchored("req-no-maxdist", {
      baseRevision: "rev-1",
      anchor: {
        text: "Hello",
        beforeContext: "same context",
        afterContext: "same after",
      },
      replacement: "Hi",
    });

    // Should apply since maxDistance defaults to Infinity
    expect(mockRespond).toHaveBeenCalled();
    const call = mockRespond.mock.calls[0][0];
    expect(call.data.success).toBe(true);
  });

  describe("calculateSimilarity edge cases (tested indirectly)", () => {
    it("returns similarity 0 when context is empty on one side", async () => {
      mockGetEditor.mockReturnValue(createMockEditor());
      // Match with empty before context vs non-empty anchor context
      mockFindTextMatches.mockReturnValue([
        {
          from: 0,
          to: 5,
          nodeId: "p-0",
          context: { before: "some text here", after: "" },
        },
      ]);

      await handleReplaceAnchored("req-empty-ctx", {
        baseRevision: "rev-1",
        anchor: {
          text: "Hello",
          beforeContext: "",
          afterContext: "something entirely different",
          maxDistance: 1000,
        },
        replacement: "Hi",
      });

      // beforeContext "" vs "some text here": a.length === 0 → sim = 0
      // afterContext "something entirely different" vs "": b.length === 0 → sim = 0
      // avg = 0 < 0.8 → filtered out
      const call = mockRespond.mock.calls[0][0];
      expect(call.data.error).toBe("not_found");
    });

    it("handles both anchor and match having identical empty contexts (sim = 1)", async () => {
      mockGetEditor.mockReturnValue(createMockEditor());
      mockFindTextMatches.mockReturnValue([
        {
          from: 0,
          to: 5,
          nodeId: "p-0",
          context: { before: "", after: "" },
        },
      ]);

      await handleReplaceAnchored("req-both-empty", {
        baseRevision: "rev-1",
        anchor: {
          text: "Hello",
          beforeContext: "",
          afterContext: "",
          maxDistance: 1000,
        },
        replacement: "Hi",
      });

      // Both empty → a === b → sim = 1 for each, avg = 1 → passes
      const call = mockRespond.mock.calls[0][0];
      expect(call.data.success).toBe(true);
    });

    it("handles anchor with null value treated as missing", async () => {
      mockGetEditor.mockReturnValue(createMockEditor());

      await handleReplaceAnchored("req-null-anchor", {
        baseRevision: "rev-1",
        anchor: null,
        replacement: "Hi",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-null-anchor",
        success: false,
        error: "Missing or invalid 'anchor' (expected object, got null)",
      });
    });
  });
});
