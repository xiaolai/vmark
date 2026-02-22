/**
 * Tests for batchEditHandler — batch_edit with idempotency cache,
 * validation, dryRun, suggest, and apply modes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
const mockIsAutoApproveEnabled = vi.fn().mockReturnValue(true);
const mockGetActiveTabId = vi.fn().mockReturnValue("tab-1");
const mockResolveNodeId = vi.fn();
const mockGetTextRange = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
  isAutoApproveEnabled: () => mockIsAutoApproveEnabled(),
  getActiveTabId: () => mockGetActiveTabId(),
  resolveNodeId: (...args: unknown[]) => mockResolveNodeId(...args),
  getTextRange: (...args: unknown[]) => mockGetTextRange(...args),
}));

// Mock revision tracker
const mockValidateBaseRevision = vi.fn();
const mockGetCurrentRevision = vi.fn().mockReturnValue("rev-new");
vi.mock("../revisionTracker", () => ({
  validateBaseRevision: (...args: unknown[]) =>
    mockValidateBaseRevision(...args),
  getCurrentRevision: () => mockGetCurrentRevision(),
}));

// Mock idempotency cache
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
vi.mock("../idempotencyCache", () => ({
  idempotencyCache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
  },
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

import { handleBatchEdit } from "../batchEditHandler";

function createMockEditor() {
  const tr = {
    replaceRange: vi.fn().mockReturnThis(),
  };
  const chainMethods = {
    focus: vi.fn().mockReturnThis(),
    setTextSelection: vi.fn().mockReturnThis(),
    deleteSelection: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };
  return {
    state: {
      doc: {
        textBetween: vi.fn().mockReturnValue("original text"),
      },
      tr,
    },
    view: {
      dispatch: vi.fn(),
    },
    chain: vi.fn().mockReturnValue(chainMethods),
    commands: {
      toggleMark: vi.fn(),
    },
    _chainMethods: chainMethods,
  };
}

describe("batchEditHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateBaseRevision.mockReturnValue(null);
    mockIsAutoApproveEnabled.mockReturnValue(true);
    mockCacheGet.mockReturnValue(undefined);
  });

  it("returns cached response for duplicate requestId", async () => {
    const cachedResponse = {
      id: "req-1",
      success: true,
      data: { cached: true },
    };
    mockCacheGet.mockReturnValue(cachedResponse);

    await handleBatchEdit("req-1", {
      requestId: "dedup-1",
      baseRevision: "rev-1",
      operations: [{ type: "update", nodeId: "p-0", text: "new" }],
    });

    expect(mockRespond).toHaveBeenCalledWith(cachedResponse);
    expect(mockValidateBaseRevision).not.toHaveBeenCalled();
  });

  it("returns revision conflict error", async () => {
    mockValidateBaseRevision.mockReturnValue({
      error: "Revision conflict",
      currentRevision: "rev-current",
    });

    await handleBatchEdit("req-2", {
      baseRevision: "rev-old",
      operations: [{ type: "update", nodeId: "p-0", text: "new" }],
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.data.code).toBe("conflict");
  });

  it("caches revision conflict response when requestId provided", async () => {
    mockValidateBaseRevision.mockReturnValue({
      error: "Revision conflict",
      currentRevision: "rev-current",
    });

    await handleBatchEdit("req-2b", {
      requestId: "dedup-2",
      baseRevision: "rev-old",
      operations: [{ type: "update", nodeId: "p-0", text: "new" }],
    });

    expect(mockCacheSet).toHaveBeenCalledWith(
      "dedup-2",
      expect.objectContaining({ success: false })
    );
  });

  it("returns error when no editor", async () => {
    mockGetEditor.mockReturnValue(null);

    await handleBatchEdit("req-3", {
      baseRevision: "rev-1",
      operations: [{ type: "update", nodeId: "p-0", text: "new" }],
    });

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-3",
      success: false,
      error: "No active editor",
    });
  });

  it("returns error for empty operations", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());

    await handleBatchEdit("req-4", {
      baseRevision: "rev-1",
      operations: [],
    });

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-4",
      success: false,
      error: "At least one operation is required",
    });
  });

  it("returns error for too many operations", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());
    const ops = Array.from({ length: 101 }, (_, i) => ({
      type: "update" as const,
      nodeId: `p-${i}`,
      text: "x",
    }));

    await handleBatchEdit("req-5", {
      baseRevision: "rev-1",
      operations: ops,
    });

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-5",
      success: false,
      error: "Maximum 100 operations per batch",
    });
  });

  it("validates required nodeId for update/delete/format", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());

    await handleBatchEdit("req-6", {
      baseRevision: "rev-1",
      operations: [
        { type: "update", text: "new" }, // missing nodeId
        { type: "delete" }, // missing nodeId
      ],
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.error).toBe("invalid_operation");
    expect(call.data.errors).toHaveLength(2);
  });

  it("validates insert requires after or nodeId", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());

    await handleBatchEdit("req-7", {
      baseRevision: "rev-1",
      operations: [{ type: "insert", content: "hello" }], // missing both
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.data.errors[0]).toContain("insert requires");
  });

  it("returns dryRun preview", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());

    await handleBatchEdit("req-8", {
      baseRevision: "rev-1",
      mode: "dryRun",
      operations: [
        { type: "update", nodeId: "p-0", text: "new" },
        { type: "delete", nodeId: "p-1" },
      ],
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.isDryRun).toBe(true);
    expect(call.data.changedNodeIds).toContain("p-0");
    expect(call.data.deletedNodeIds).toContain("p-1");
  });

  it("returns error when node is not found", async () => {
    mockGetEditor.mockReturnValue(createMockEditor());
    mockResolveNodeId.mockReturnValue(null);

    await handleBatchEdit("req-9", {
      baseRevision: "rev-1",
      operations: [{ type: "update", nodeId: "p-999", text: "new" }],
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.error).toContain("Node not found: p-999");
  });

  it("creates suggestions in suggest mode", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);
    mockIsAutoApproveEnabled.mockReturnValue(false);
    mockResolveNodeId.mockReturnValue({ from: 0, to: 10 });
    mockGetTextRange.mockReturnValue({ from: 1, to: 9 });

    await handleBatchEdit("req-10", {
      baseRevision: "rev-1",
      mode: "suggest",
      operations: [{ type: "update", nodeId: "p-0", text: "new text" }],
    });

    expect(mockAddSuggestion).toHaveBeenCalled();
    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.suggestionIds).toHaveLength(1);
  });

  it("applies update operation in apply mode", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);
    mockResolveNodeId.mockReturnValue({ from: 0, to: 10 });
    mockGetTextRange.mockReturnValue({ from: 1, to: 9 });

    await handleBatchEdit("req-11", {
      baseRevision: "rev-1",
      mode: "apply",
      operations: [{ type: "update", nodeId: "p-0", text: "new text" }],
    });

    expect(editor.view.dispatch).toHaveBeenCalled();
    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.changedNodeIds).toContain("p-0");
  });

  it("applies delete operation", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);
    mockResolveNodeId.mockReturnValue({ from: 0, to: 10 });

    await handleBatchEdit("req-12", {
      baseRevision: "rev-1",
      mode: "apply",
      operations: [{ type: "delete", nodeId: "p-0" }],
    });

    expect(editor._chainMethods.deleteSelection).toHaveBeenCalled();
    const call = mockRespond.mock.calls[0][0];
    expect(call.data.deletedNodeIds).toContain("p-0");
  });

  it("applies insert operation with after target", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);
    mockResolveNodeId.mockReturnValue({ from: 0, to: 10 });

    await handleBatchEdit("req-13", {
      baseRevision: "rev-1",
      mode: "apply",
      operations: [
        { type: "insert", after: "p-0", content: "inserted text" },
      ],
    });

    expect(editor.view.dispatch).toHaveBeenCalled();
    const call = mockRespond.mock.calls[0][0];
    expect(call.data.addedNodeIds).toHaveLength(1);
  });

  it("caches response when requestId provided", async () => {
    const editor = createMockEditor();
    mockGetEditor.mockReturnValue(editor);
    mockResolveNodeId.mockReturnValue({ from: 0, to: 10 });
    mockGetTextRange.mockReturnValue({ from: 1, to: 9 });

    await handleBatchEdit("req-14", {
      requestId: "dedup-14",
      baseRevision: "rev-1",
      mode: "apply",
      operations: [{ type: "update", nodeId: "p-0", text: "new" }],
    });

    expect(mockCacheSet).toHaveBeenCalledWith(
      "dedup-14",
      expect.objectContaining({ success: true })
    );
  });
});
