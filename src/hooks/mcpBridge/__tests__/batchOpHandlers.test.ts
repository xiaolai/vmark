/**
 * Tests for batchOpHandlers — table_batch_modify and list_batch_modify.
 *
 * These handlers are the most complex MCP bridge handlers (660+ lines).
 * Tests focus on argument validation, error handling, and edge cases.
 * Deep ProseMirror integration is tested at the handler boundary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
const mockIsAutoApproveEnabled = vi.fn().mockReturnValue(true);
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
  isAutoApproveEnabled: () => mockIsAutoApproveEnabled(),
}));

// Mock revision tracker
const mockValidateBaseRevision = vi.fn();
const mockGetCurrentRevision = vi.fn().mockReturnValue("rev-new");
vi.mock("../revisionTracker", () => ({
  validateBaseRevision: (...args: unknown[]) =>
    mockValidateBaseRevision(...args),
  getCurrentRevision: () => mockGetCurrentRevision(),
}));

// Mock markdown paste slice
vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  createMarkdownPasteSlice: vi.fn().mockReturnValue({ content: "mock" }),
}));

import {
  handleTableBatchModify,
  handleListBatchModify,
} from "../batchOpHandlers";

describe("batchOpHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateBaseRevision.mockReturnValue(null);
    mockIsAutoApproveEnabled.mockReturnValue(true);
  });

  describe("handleTableBatchModify", () => {
    it("returns revision conflict error", async () => {
      mockValidateBaseRevision.mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleTableBatchModify("req-1", {
        baseRevision: "rev-old",
        target: { tableIndex: 0 },
        operations: [],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data.code).toBe("conflict");
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleTableBatchModify("req-2", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [],
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-2",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when target is missing", async () => {
      mockGetEditor.mockReturnValue({
        state: { doc: { descendants: vi.fn() } },
      });

      await handleTableBatchModify("req-3", {
        baseRevision: "rev-1",
        operations: [{ action: "add_row", at: 0, cells: ["a"] }],
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-3",
        success: false,
        error: "target is required",
      });
    });

    it("returns error when operations is empty", async () => {
      mockGetEditor.mockReturnValue({
        state: { doc: { descendants: vi.fn() } },
      });

      await handleTableBatchModify("req-5", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [],
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: "At least one operation is required",
      });
    });

    it("returns not_found when table is not found", async () => {
      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              // No table nodes
              cb(
                {
                  type: { name: "paragraph" },
                  nodeSize: 10,
                },
                0
              );
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-6", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "update_cell", row: 0, col: 0, content: "x" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toContain("Table not found");
    });

    it("returns dryRun preview without making changes", async () => {
      // Create a minimal table mock
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 2,
        child: (i: number) => ({
          type: { name: i === 0 ? "tableHeader" : "tableCell" },
          nodeSize: 5,
          textContent: `cell-${i}`,
        }),
        nodeSize: 12,
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 2,
        child: () => tableRow,
        content: { size: 24 },
        nodeSize: 26,
        descendants: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(tableNode, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-7", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [
          { action: "update_cell", row: 0, col: 0, content: "new" },
        ],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isDryRun).toBe(true);
    });
  });

  describe("handleListBatchModify", () => {
    it("returns revision conflict error", async () => {
      mockValidateBaseRevision.mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleListBatchModify("req-8", {
        baseRevision: "rev-old",
        target: { listIndex: 0 },
        operations: [],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data.code).toBe("conflict");
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleListBatchModify("req-9", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [],
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-9",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when target is missing", async () => {
      mockGetEditor.mockReturnValue({
        state: { doc: { descendants: vi.fn() } },
      });

      await handleListBatchModify("req-10", {
        baseRevision: "rev-1",
        operations: [{ action: "add_item", at: 0, text: "item" }],
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-10",
        success: false,
        error: "target is required",
      });
    });

    it("returns not_found when list is not found", async () => {
      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              // No list nodes
              cb(
                {
                  type: { name: "paragraph" },
                  nodeSize: 10,
                },
                0
              );
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-12", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "add_item", at: 0, text: "item" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toContain("List not found");
    });

    it("returns error when operations is empty", async () => {
      mockGetEditor.mockReturnValue({
        state: { doc: { descendants: vi.fn() } },
      });

      await handleListBatchModify("req-13", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [],
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-13",
        success: false,
        error: "At least one operation is required",
      });
    });
  });
});
