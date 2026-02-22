/**
 * MCP Bridge — Batch Edit Handler Tests
 *
 * Tests for handleBatchEdit: idempotency, revision validation, mode branches
 * (apply/suggest/dryRun), operation validation, node resolution, and edge cases.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock utils
vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
  isAutoApproveEnabled: vi.fn(() => true),
  getActiveTabId: vi.fn(() => "test-tab"),
  resolveNodeId: vi.fn(() => ({ from: 0, to: 10 })),
  getTextRange: vi.fn(() => ({ from: 1, to: 9 })),
}));

// Mock revisionTracker
vi.mock("./revisionTracker", () => ({
  validateBaseRevision: vi.fn(() => null),
  getCurrentRevision: vi.fn(() => "rev-new"),
}));

// Mock aiSuggestionStore
vi.mock("@/stores/aiSuggestionStore", () => ({
  useAiSuggestionStore: {
    getState: vi.fn(() => ({
      addSuggestion: vi.fn(() => "sug-1"),
    })),
  },
}));

// Mock idempotencyCache
vi.mock("./idempotencyCache", () => ({
  idempotencyCache: {
    get: vi.fn(() => undefined),
    set: vi.fn(),
  },
}));

// Mock markdownPaste
vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  createMarkdownPasteSlice: vi.fn(() => ({ content: { size: 5 } })),
}));

import { handleBatchEdit } from "./batchEditHandler";
import { respond, getEditor, isAutoApproveEnabled, resolveNodeId } from "./utils";
import { validateBaseRevision } from "./revisionTracker";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { idempotencyCache } from "./idempotencyCache";

function createMockEditor() {
  const mockChain = {
    focus: vi.fn().mockReturnThis(),
    setTextSelection: vi.fn().mockReturnThis(),
    deleteSelection: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };
  return {
    state: {
      doc: {
        textBetween: vi.fn(() => "original text"),
      },
      tr: { replaceRange: vi.fn().mockReturnThis() },
    },
    view: { dispatch: vi.fn() },
    chain: vi.fn(() => mockChain),
    commands: {
      toggleMark: vi.fn(),
    },
  };
}

describe("batchEditHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateBaseRevision).mockReturnValue(null);
    vi.mocked(isAutoApproveEnabled).mockReturnValue(true);
    vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);
    vi.mocked(resolveNodeId).mockReturnValue({ from: 0, to: 10, type: "paragraph", text: "hello" } as never);
    vi.mocked(idempotencyCache.get).mockReturnValue(undefined);
  });

  describe("idempotency", () => {
    it("returns cached response for duplicate requestId", async () => {
      const cached = { id: "req-1", success: true, data: { cached: true } };
      vi.mocked(idempotencyCache.get).mockReturnValue(cached as never);

      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        requestId: "dedup-1",
        mode: "apply",
        operations: [{ type: "delete", nodeId: "p-0" }],
      });

      expect(idempotencyCache.get).toHaveBeenCalledWith("dedup-1");
      expect(respond).toHaveBeenCalledWith(cached);
      // Should not proceed to validation
      expect(validateBaseRevision).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("returns revision conflict error", async () => {
      vi.mocked(validateBaseRevision).mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleBatchEdit("req-1", {
        baseRevision: "rev-old",
        mode: "apply",
        operations: [{ type: "delete", nodeId: "p-0" }],
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

      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        mode: "apply",
        operations: [{ type: "delete", nodeId: "p-0" }],
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when operations empty", async () => {
      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        mode: "apply",
        operations: [],
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "At least one operation is required",
      });
    });

    it("returns error when operations exceed 100", async () => {
      const ops = Array.from({ length: 101 }, (_, i) => ({
        type: "delete",
        nodeId: `p-${i}`,
      }));

      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        mode: "apply",
        operations: ops,
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Maximum 100 operations per batch",
      });
    });

    it("validates update requires nodeId", async () => {
      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        mode: "apply",
        operations: [{ type: "update", text: "new text" }],
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "invalid_operation",
        data: {
          code: "invalid_operation",
          errors: ["Operation 0: update requires nodeId"],
        },
      });
    });

    it("validates insert requires after or nodeId", async () => {
      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        mode: "apply",
        operations: [{ type: "insert", content: "new block" }],
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "invalid_operation",
        data: {
          code: "invalid_operation",
          errors: ["Operation 0: insert requires 'after' or 'nodeId' to specify position"],
        },
      });
    });
  });

  describe("node resolution", () => {
    it("returns node_not_found for unresolved nodeId", async () => {
      vi.mocked(resolveNodeId).mockReturnValue(null as never);

      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        mode: "apply",
        operations: [{ type: "delete", nodeId: "p-99" }],
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Node not found: p-99",
        data: { code: "node_not_found", nodeId: "p-99" },
      });
    });
  });

  describe("dryRun mode", () => {
    it("returns dryRun preview", async () => {
      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        mode: "dryRun",
        operations: [
          { type: "update", nodeId: "p-0", text: "changed" },
          { type: "delete", nodeId: "p-1" },
        ],
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: {
          success: true,
          newRevision: null,
          changedNodeIds: ["p-0"],
          addedNodeIds: [],
          deletedNodeIds: ["p-1"],
          idRemap: {},
          warnings: [],
          isDryRun: true,
        },
      });
    });
  });

  describe("suggest mode", () => {
    it("creates suggestions in suggest mode", async () => {
      const addSuggestion = vi.fn(() => "sug-abc");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({
        addSuggestion,
      } as never);
      vi.mocked(isAutoApproveEnabled).mockReturnValue(false);

      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        mode: "suggest",
        operations: [
          { type: "insert", after: "p-0", content: "new paragraph" },
          { type: "update", nodeId: "p-1", text: "updated text" },
          { type: "delete", nodeId: "p-2" },
        ],
      });

      expect(addSuggestion).toHaveBeenCalledTimes(3);
      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "req-1",
          success: true,
          data: expect.objectContaining({
            success: true,
            suggestionIds: ["sug-abc", "sug-abc", "sug-abc"],
          }),
        }),
      );
    });
  });

  describe("apply mode", () => {
    it("applies insert operation in apply mode", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        mode: "apply",
        operations: [{ type: "insert", after: "p-0", content: "new content" }],
      });

      expect(editor.state.tr.replaceRange).toHaveBeenCalled();
      expect(editor.view.dispatch).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            success: true,
            newRevision: "rev-new",
            addedNodeIds: ["inserted-0"],
          }),
        }),
      );
    });

    it("applies update operation in apply mode", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        mode: "apply",
        operations: [{ type: "update", nodeId: "p-0", text: "updated" }],
      });

      expect(editor.state.tr.replaceRange).toHaveBeenCalled();
      expect(editor.view.dispatch).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            changedNodeIds: ["p-0"],
          }),
        }),
      );
    });

    it("applies delete operation in apply mode", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);
      const mockChain = editor.chain();

      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        mode: "apply",
        operations: [{ type: "delete", nodeId: "p-0" }],
      });

      expect(mockChain.focus).toHaveBeenCalled();
      expect(mockChain.setTextSelection).toHaveBeenCalled();
      expect(mockChain.deleteSelection).toHaveBeenCalled();
      expect(mockChain.run).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            deletedNodeIds: ["p-0"],
          }),
        }),
      );
    });

    it("applies format operation in apply mode", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        mode: "apply",
        operations: [
          {
            type: "format",
            nodeId: "p-0",
            marks: [{ type: "bold" }, { type: "italic", attrs: {} }],
          },
        ],
      });

      expect(editor.commands.toggleMark).toHaveBeenCalledTimes(2);
      expect(editor.commands.toggleMark).toHaveBeenCalledWith("bold", undefined);
      expect(editor.commands.toggleMark).toHaveBeenCalledWith("italic", {});
      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            changedNodeIds: ["p-0"],
          }),
        }),
      );
    });

    it("warns on unknown operation type", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        mode: "apply",
        operations: [{ type: "unknown_op", nodeId: "p-0" }],
      });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            warnings: ["Unknown operation type: unknown_op"],
          }),
        }),
      );
    });
  });

  describe("caching", () => {
    it("caches response with requestId", async () => {
      await handleBatchEdit("req-1", {
        baseRevision: "rev-1",
        requestId: "cache-me",
        mode: "apply",
        operations: [{ type: "delete", nodeId: "p-0" }],
      });

      expect(idempotencyCache.set).toHaveBeenCalledWith(
        "cache-me",
        expect.objectContaining({ id: "req-1", success: true }),
      );
    });
  });
});