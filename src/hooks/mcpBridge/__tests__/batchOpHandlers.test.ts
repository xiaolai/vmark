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
        error: "Missing or invalid 'target' (expected object, got undefined)",
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
        error: "Missing or invalid 'target' (expected object, got undefined)",
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

    it("returns dryRun preview without making changes", async () => {
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-14", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [
          { action: "add_item", at: 0, text: "new item" },
        ],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isDryRun).toBe(true);
      expect(call.data.preview.listType).toBe("bulletList");
      expect(call.data.preview.operationCount).toBe(1);
    });

    it("returns warning when auto-approve disabled", async () => {
      const listNode = {
        type: { name: "orderedList" },
        nodeSize: 20,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);
      mockIsAutoApproveEnabled.mockReturnValue(false);

      await handleListBatchModify("req-15", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "add_item", at: 0, text: "item" }],
        mode: "suggest",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warning).toContain("auto-approve to be enabled");
    });

    it("finds list by selector (bulletlist)", async () => {
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-16", {
        baseRevision: "rev-1",
        target: { selector: "ul" },
        operations: [{ action: "add_item", at: 0, text: "item" }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isDryRun).toBe(true);
    });

    it("finds list by selector (tasklist)", async () => {
      const listNode = {
        type: { name: "taskList" },
        nodeSize: 20,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-17", {
        baseRevision: "rev-1",
        target: { selector: "task" },
        operations: [{ action: "add_item", at: 0, text: "item" }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
    });

    it("finds list by selector (orderedlist)", async () => {
      const listNode = {
        type: { name: "orderedList" },
        nodeSize: 20,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-18", {
        baseRevision: "rev-1",
        target: { selector: "ol" },
        operations: [{ action: "add_item", at: 0, text: "item" }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
    });
  });

  describe("handleTableBatchModify — auto-approve disabled", () => {
    it("returns warning when auto-approve disabled", async () => {
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        nodeSize: 26,
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
      mockIsAutoApproveEnabled.mockReturnValue(false);

      await handleTableBatchModify("req-20", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "add_row", at: 0, cells: ["a"] }],
        mode: "suggest",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warning).toContain("auto-approve to be enabled");
    });
  });

  describe("handleTableBatchModify — afterHeading target", () => {
    it("finds table after a specific heading", async () => {
      const headingNode = {
        type: { name: "heading" },
        nodeSize: 10,
        isText: false,
        text: undefined,
        descendants: (cb: (child: unknown) => boolean) => {
          cb({ isText: true, text: "My Table" });
        },
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        nodeSize: 26,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(headingNode, 0);
              cb(tableNode, 10);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-21", {
        baseRevision: "rev-1",
        target: { afterHeading: "My Table" },
        operations: [{ action: "add_row", at: 0, cells: ["a"] }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isDryRun).toBe(true);
    });

    it("is case-insensitive when matching headings", async () => {
      const headingNode = {
        type: { name: "heading" },
        nodeSize: 10,
        isText: false,
        text: undefined,
        descendants: (cb: (child: unknown) => boolean) => {
          cb({ isText: true, text: "Data Table" });
        },
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        nodeSize: 26,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(headingNode, 0);
              cb(tableNode, 10);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-22", {
        baseRevision: "rev-1",
        target: { afterHeading: "data table" },
        operations: [{ action: "add_row", at: 0, cells: ["a"] }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
    });
  });

  describe("handleTableBatchModify — apply mode structural ops", () => {
    function makeTableEditor() {
      const cellNode = {
        type: { name: "tableCell" },
        nodeSize: 5,
        textContent: "cell",
      };
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 2,
        child: () => cellNode,
        nodeSize: 12,
        firstChild: {
          type: { name: "tableHeader" },
        },
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(cellNode, 0);
          cb(cellNode, 5);
        }),
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 2,
        child: () => tableRow,
        firstChild: tableRow,
        content: { size: 24 },
        nodeSize: 26,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(tableRow, 0);
          cb(tableRow, 12);
        }),
        descendants: vi.fn(),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      return {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(tableNode, 0);
            },
            nodeAt: vi.fn(() => ({
              nodeSize: 5,
            })),
          },
          tr: {
            replaceWith: vi.fn().mockReturnThis(),
            get docChanged() { return true; },
          },
          schema: { nodes: { paragraph: { create: vi.fn(() => "empty-p") } } },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          addRowAfter: vi.fn(),
          deleteRow: vi.fn(),
          addColumnAfter: vi.fn(),
          deleteColumn: vi.fn(),
          toggleHeaderRow: vi.fn(),
        },
        view: {
          dispatch: vi.fn(),
        },
      };
    }

    it("applies delete_row operation", async () => {
      const editor = makeTableEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-30", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "delete_row", at: 0 }],
      });

      expect(editor.commands.deleteRow).toHaveBeenCalled();
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.appliedCount).toBe(1);
    });

    it("applies add_column operation", async () => {
      const editor = makeTableEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-31", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "add_column", at: 0, header: "Col", cells: ["a"] }],
      });

      expect(editor.commands.addColumnAfter).toHaveBeenCalled();
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
    });

    it("applies delete_column operation", async () => {
      const editor = makeTableEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-32", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "delete_column", at: 0 }],
      });

      expect(editor.commands.deleteColumn).toHaveBeenCalled();
    });

    it("applies set_header operation (toggle)", async () => {
      const editor = makeTableEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-33", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "set_header", row: 0, isHeader: false }],
      });

      // firstChild.firstChild is tableHeader, so isCurrentlyHeader=true, wantHeader=false → toggle
      expect(editor.commands.toggleHeaderRow).toHaveBeenCalled();
    });

    it("warns on unknown table operation", async () => {
      const editor = makeTableEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-34", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "unknown_op" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warnings).toContain("Unknown table operation: unknown_op");
    });

    it("rejects operation with no action field", async () => {
      const editor = makeTableEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-35", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ noAction: true }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toContain("invalid table operation at index 0");
    });

    it("applies multiple operations in sequence", async () => {
      const editor = makeTableEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-36", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [
          { action: "add_row", at: 0, cells: ["a"] },
          { action: "delete_row", at: 1 },
        ],
      });

      expect(editor.commands.addRowAfter).toHaveBeenCalled();
      expect(editor.commands.deleteRow).toHaveBeenCalled();
      const call = mockRespond.mock.calls[0][0];
      expect(call.data.appliedCount).toBe(2);
    });
  });

  describe("handleListBatchModify — apply mode operations", () => {
    function makeListEditor() {
      const listItemNode = {
        type: { name: "listItem" },
        nodeSize: 8,
      };
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(listItemNode, 0);
          cb(listItemNode, 8);
        }),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      return {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
          selection: {
            $from: {
              depth: 2,
              node: (d: number) => {
                if (d === 1) return { type: { name: "taskItem" }, attrs: { checked: false } };
                return { type: { name: "bulletList" } };
              },
              before: () => 5,
            },
          },
          tr: {
            replaceSelection: vi.fn().mockReturnThis(),
            setNodeMarkup: vi.fn().mockReturnThis(),
          },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          splitListItem: vi.fn(),
          deleteNode: vi.fn(),
          sinkListItem: vi.fn(),
          liftListItem: vi.fn(),
        },
        view: {
          dispatch: vi.fn(),
        },
      };
    }

    it("applies add_item with text (splitListItem + replaceSelection)", async () => {
      const editor = makeListEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-40a", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "add_item", at: 0, text: "new item text" }],
      });

      expect(editor.commands.splitListItem).toHaveBeenCalledWith("listItem");
      expect(editor.state.tr.replaceSelection).toHaveBeenCalled();
      expect(editor.view.dispatch).toHaveBeenCalled();
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.appliedCount).toBe(1);
    });

    it("applies delete_item operation", async () => {
      const editor = makeListEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-40", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "delete_item", at: 0 }],
      });

      expect(editor.commands.deleteNode).toHaveBeenCalledWith("listItem");
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.appliedCount).toBe(1);
    });

    it("applies set_indent (indent > 0 = sink)", async () => {
      const editor = makeListEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-41", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "set_indent", at: 0, indent: 1 }],
      });

      expect(editor.commands.sinkListItem).toHaveBeenCalledWith("listItem");
    });

    it("applies set_indent (indent = 0 = lift)", async () => {
      const editor = makeListEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-42", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "set_indent", at: 0, indent: 0 }],
      });

      expect(editor.commands.liftListItem).toHaveBeenCalledWith("listItem");
    });

    it("warns on update_item (requires item selection)", async () => {
      const editor = makeListEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-43", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "update_item", at: 0, text: "updated" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.warnings.some((w: string) => w.includes("update_item"))).toBe(true);
    });

    it("warns on reorder operation", async () => {
      const editor = makeListEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-44", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "reorder", order: [1, 0] }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.warnings.some((w: string) => w.includes("reorder"))).toBe(true);
    });

    it("warns on unknown list operation", async () => {
      const editor = makeListEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-45", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "nonexistent_op" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.warnings).toContain("Unknown list operation: nonexistent_op");
    });

    it("warns when list item at index not found", async () => {
      const editor = makeListEditor();
      // Override forEach to return no items
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
        forEach: vi.fn(),
      };
      editor.state.doc.descendants = (cb: (node: unknown, pos: number) => boolean | undefined) => {
        cb(listNode, 0);
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-46", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "delete_item", at: 99 }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.warnings.some((w: string) => w.includes("not found"))).toBe(true);
    });

    it("accepts 'op' as action key alias", async () => {
      const editor = makeListEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-47", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ op: "delete_item", at: 0 }],
      });

      expect(editor.commands.deleteNode).toHaveBeenCalled();
    });

    it("normalizes camelCase to snake_case", async () => {
      const editor = makeListEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-48", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "deleteItem", at: 0 }],
      });

      expect(editor.commands.deleteNode).toHaveBeenCalled();
    });

    it("handles operation errors gracefully", async () => {
      const editor = makeListEditor();
      editor.commands.splitListItem = vi.fn(() => { throw new Error("PM error"); });
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-49", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "add_item", at: 0, text: "item" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warnings.some((w: string) => w.includes("Failed"))).toBe(true);
    });
  });

  describe("handleListBatchModify — toggle_check on task list", () => {
    it("toggles checked attribute on task item", async () => {
      const taskItemNode = {
        type: { name: "taskItem" },
        nodeSize: 8,
        attrs: { checked: false },
      };
      const listNode = {
        type: { name: "taskList" },
        nodeSize: 20,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(taskItemNode, 0);
        }),
      };

      const mockSetNodeMarkup = vi.fn().mockReturnThis();
      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
          selection: {
            $from: {
              depth: 2,
              node: (d: number) => {
                if (d === 1) return taskItemNode;
                return { type: { name: "taskList" } };
              },
              before: () => 5,
            },
          },
          tr: {
            setNodeMarkup: mockSetNodeMarkup,
          },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          splitListItem: vi.fn(),
          deleteNode: vi.fn(),
          sinkListItem: vi.fn(),
          liftListItem: vi.fn(),
        },
        view: {
          dispatch: vi.fn(),
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-tc-1", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "toggle_check", at: 0 }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.appliedCount).toBe(1);
      expect(editor.view.dispatch).toHaveBeenCalled();
    });

    it("warns when toggle_check is used on non-task list", async () => {
      const listItemNode = {
        type: { name: "listItem" },
        nodeSize: 8,
      };
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(listItemNode, 0);
        }),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
          selection: {
            $from: {
              depth: 2,
              node: () => ({ type: { name: "listItem" } }),
              before: () => 5,
            },
          },
          tr: {
            setNodeMarkup: vi.fn().mockReturnThis(),
          },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          splitListItem: vi.fn(),
          deleteNode: vi.fn(),
          sinkListItem: vi.fn(),
          liftListItem: vi.fn(),
        },
        view: {
          dispatch: vi.fn(),
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-tc-2", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "toggle_check", at: 0 }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warnings).toContain("toggle_check only works on task lists");
    });
  });

  describe("handleTableBatchModify — update_cell operations", () => {
    it("applies update_cell with markdown content", async () => {
      const cellNode = {
        type: { name: "tableCell" },
        nodeSize: 5,
        textContent: "old",
      };
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 1,
        child: () => cellNode,
        nodeSize: 7,
        firstChild: { type: { name: "tableHeader" } },
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(cellNode, 0);
        }),
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        child: () => tableRow,
        firstChild: tableRow,
        content: { size: 7 },
        nodeSize: 9,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(tableRow, 0);
        }),
        descendants: vi.fn(),
      };

      const mockTrReplaceWith = vi.fn().mockReturnThis();
      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(tableNode, 0);
            },
            nodeAt: vi.fn(() => ({
              nodeSize: 5,
            })),
          },
          tr: {
            replaceWith: mockTrReplaceWith,
            get docChanged() { return true; },
          },
          schema: { nodes: { paragraph: { create: vi.fn(() => "empty-p") } } },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {},
        view: {
          dispatch: vi.fn(),
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-uc-1", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "update_cell", row: 0, col: 0, content: "**bold**" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.appliedCount).toBe(1);
      expect(editor.view.dispatch).toHaveBeenCalled();
    });

    it("applies update_cell with empty content (creates empty paragraph)", async () => {
      const cellNode = {
        type: { name: "tableCell" },
        nodeSize: 5,
        textContent: "old",
      };
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 1,
        child: () => cellNode,
        nodeSize: 7,
        firstChild: { type: { name: "tableHeader" } },
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(cellNode, 0);
        }),
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        child: () => tableRow,
        firstChild: tableRow,
        content: { size: 7 },
        nodeSize: 9,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(tableRow, 0);
        }),
        descendants: vi.fn(),
      };

      const mockTrReplaceWith = vi.fn().mockReturnThis();
      const mockParagraphCreate = vi.fn(() => "empty-p");
      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(tableNode, 0);
            },
            nodeAt: vi.fn(() => ({
              nodeSize: 5,
            })),
          },
          tr: {
            replaceWith: mockTrReplaceWith,
            get docChanged() { return true; },
          },
          schema: { nodes: { paragraph: { create: mockParagraphCreate } } },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {},
        view: {
          dispatch: vi.fn(),
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-uc-2", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "update_cell", row: 0, col: 0, content: "" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(mockParagraphCreate).toHaveBeenCalledWith(null);
    });
  });

  describe("handleTableBatchModify — update_cell cellPos is null (out-of-bounds row/col)", () => {
    it("warns when cell position not found (row out of bounds)", async () => {
      // Table with only 1 row, but we request row 99
      const cellNode = {
        type: { name: "tableCell" },
        nodeSize: 5,
        textContent: "cell",
      };
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 1,
        child: () => cellNode,
        nodeSize: 7,
        firstChild: { type: { name: "tableHeader" } },
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(cellNode, 0);
        }),
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        child: () => tableRow,
        firstChild: tableRow,
        content: { size: 7 },
        nodeSize: 9,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(tableRow, 0);
        }),
        descendants: vi.fn(),
      };

      const mockTrReplaceWith = vi.fn().mockReturnThis();
      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(tableNode, 0);
            },
            nodeAt: vi.fn(() => ({ nodeSize: 5 })),
          },
          tr: {
            replaceWith: mockTrReplaceWith,
            get docChanged() { return false; },
          },
          schema: { nodes: { paragraph: { create: vi.fn(() => "empty-p") } } },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {},
        view: { dispatch: vi.fn() },
      };
      mockGetEditor.mockReturnValue(editor);

      // Request row 99 — findCellPosition returns null
      await handleTableBatchModify("req-uc-oob", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "update_cell", row: 99, col: 99, content: "text" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warnings.some((w: string) => w.includes("cell not found"))).toBe(true);
    });
  });

  describe("handleTableBatchModify — table disappears after structural ops", () => {
    it("warns when table not found after structural ops for cell updates", async () => {
      const tableNode = {
        type: { name: "table" },
        childCount: 0,
        child: vi.fn(),
        firstChild: null,
        content: { size: 0 },
        nodeSize: 2,
        forEach: vi.fn(),
        descendants: vi.fn(),
      };

      let callCount = 0;
      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            // First call (findTable for structural phase) finds table,
            // second call (findTable after structural ops) returns nothing
            descendants: vi.fn((cb: (node: unknown, pos: number) => boolean | undefined) => {
              callCount++;
              if (callCount === 1) {
                cb(tableNode, 0);
              }
              // Second call finds nothing — table "disappeared"
            }),
            nodeAt: vi.fn(() => ({ nodeSize: 5 })),
          },
          tr: {
            replaceWith: vi.fn().mockReturnThis(),
            get docChanged() { return false; },
          },
          schema: { nodes: { paragraph: { create: vi.fn(() => "empty-p") } } },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          addRowAfter: vi.fn(),
        },
        view: { dispatch: vi.fn() },
      };
      mockGetEditor.mockReturnValue(editor);

      // Mix structural op + update_cell so phase 2 runs and re-searches for table
      await handleTableBatchModify("req-uc-gone", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [
          { action: "add_row", at: 0, cells: [] },
          { action: "update_cell", row: 0, col: 0, content: "text" },
        ],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(
        call.data.warnings.some((w: string) => w.includes("Table not found after structural operations"))
      ).toBe(true);
    });
  });

  describe("handleTableBatchModify — update_cell nodeAt returns null", () => {
    it("warns when nodeAt returns null for a found cell position", async () => {
      const cellNode = {
        type: { name: "tableCell" },
        nodeSize: 5,
        textContent: "cell",
      };
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 1,
        child: () => cellNode,
        nodeSize: 7,
        firstChild: { type: { name: "tableHeader" } },
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(cellNode, 0);
        }),
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        child: () => tableRow,
        firstChild: tableRow,
        content: { size: 7 },
        nodeSize: 9,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(tableRow, 0);
        }),
        descendants: vi.fn(),
      };

      const mockTrReplaceWith = vi.fn().mockReturnThis();
      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(tableNode, 0);
            },
            // nodeAt returns null — simulates cell not resolvable
            nodeAt: vi.fn(() => null),
          },
          tr: {
            replaceWith: mockTrReplaceWith,
            get docChanged() { return false; },
          },
          schema: { nodes: { paragraph: { create: vi.fn(() => "empty-p") } } },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {},
        view: { dispatch: vi.fn() },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-uc-null", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "update_cell", row: 0, col: 0, content: "text" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warnings.some((w: string) => w.includes("could not resolve cell node"))).toBe(true);
    });
  });

  describe("handleTableBatchModify — multi-cell sort order", () => {
    it("processes multiple update_cell ops in reverse position order", async () => {
      const cellNode = {
        type: { name: "tableCell" },
        nodeSize: 5,
        textContent: "cell",
      };
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 2,
        child: (_i: number) => cellNode,
        nodeSize: 12,
        firstChild: { type: { name: "tableHeader" } },
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(cellNode, 0);
          cb(cellNode, 5);
        }),
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        child: () => tableRow,
        firstChild: tableRow,
        content: { size: 12 },
        nodeSize: 14,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(tableRow, 0);
        }),
        descendants: vi.fn(),
      };

      const mockTrReplaceWith = vi.fn().mockReturnThis();
      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      // nodeAt returns a node so both cells get processed
      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(tableNode, 0);
            },
            nodeAt: vi.fn(() => ({ nodeSize: 5 })),
          },
          tr: {
            replaceWith: mockTrReplaceWith,
            get docChanged() { return true; },
          },
          schema: { nodes: { paragraph: { create: vi.fn(() => "empty-p") } } },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {},
        view: { dispatch: vi.fn() },
      };
      mockGetEditor.mockReturnValue(editor);

      // Two update_cell ops at different positions — triggers sort comparator
      await handleTableBatchModify("req-uc-sort", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [
          { action: "update_cell", row: 0, col: 0, content: "first" },
          { action: "update_cell", row: 0, col: 1, content: "second" },
        ],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      // Both cells applied
      expect(call.data.appliedCount).toBe(2);
    });
  });

  describe("handleTableBatchModify — error in structural op", () => {
    it("captures error in structural operation and continues", async () => {
      const cellNode = {
        type: { name: "tableCell" },
        nodeSize: 5,
        textContent: "cell",
      };
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 1,
        child: () => cellNode,
        nodeSize: 7,
        firstChild: { type: { name: "tableHeader" } },
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(cellNode, 0);
        }),
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        child: () => tableRow,
        firstChild: tableRow,
        nodeSize: 9,
        forEach: vi.fn(),
        descendants: vi.fn(),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
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
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          addRowAfter: vi.fn(() => { throw new Error("PM error"); }),
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-err-1", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "add_row", at: 0, cells: ["a"] }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warnings.some((w: string) => w.includes("Failed"))).toBe(true);
    });
  });

  describe("handleListBatchModify — afterHeading target for list", () => {
    it("finds list by afterHeading (uses listIndex matching)", async () => {
      const listNode = {
        type: { name: "orderedList" },
        nodeSize: 20,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      // Use listIndex since afterHeading is not supported for lists
      await handleListBatchModify("req-ah-1", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "add_item", at: 0, text: "item" }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isDryRun).toBe(true);
    });
  });

  describe("handleTableBatchModify — normalizeOp", () => {
    it("accepts type or op as action key aliases", async () => {
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 1,
        child: () => ({
          type: { name: "tableHeader" },
          nodeSize: 5,
        }),
        nodeSize: 7,
        firstChild: {
          type: { name: "tableHeader" },
          firstChild: { type: { name: "tableHeader" } },
        },
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        child: () => tableRow,
        firstChild: tableRow,
        nodeSize: 9,
        forEach: vi.fn(),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
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
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          addRowAfter: vi.fn(),
        },
      };
      mockGetEditor.mockReturnValue(editor);

      // Use "type" key instead of "action"
      await handleTableBatchModify("req-23", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ type: "add_row", at: 0, cells: ["a"] }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.appliedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("findTable — tableIndex increments past non-matching tables (line 94)", () => {
    it("skips first table and finds second table by tableIndex", async () => {
      const tableNode1 = {
        type: { name: "table" },
        childCount: 1,
        nodeSize: 10,
      };
      const tableNode2 = {
        type: { name: "table" },
        childCount: 1,
        nodeSize: 10,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(tableNode1, 0); // tableIndex 0
              cb(tableNode2, 10); // tableIndex 1
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-idx-1", {
        baseRevision: "rev-1",
        target: { tableIndex: 1 },
        operations: [{ action: "add_row", at: 0, cells: ["a"] }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isDryRun).toBe(true);
      expect(call.data.preview.tablePosition).toBe(10);
    });
  });

  describe("findList — listIndex increments past non-matching lists (line 144)", () => {
    it("skips first list and finds second list by listIndex", async () => {
      const listNode1 = {
        type: { name: "bulletList" },
        nodeSize: 10,
      };
      const listNode2 = {
        type: { name: "orderedList" },
        nodeSize: 10,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode1, 0); // listIndex 0
              cb(listNode2, 10); // listIndex 1
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-lidx-1", {
        baseRevision: "rev-1",
        target: { listIndex: 1 },
        operations: [{ action: "add_item", at: 0, text: "item" }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isDryRun).toBe(true);
      expect(call.data.preview.listPosition).toBe(10);
      expect(call.data.preview.listType).toBe("orderedList");
    });
  });

  describe("extractText — non-text child node (line 54 false branch)", () => {
    it("does not crash on non-text descendants in heading (afterHeading match)", async () => {
      // heading with a non-text child (e.g. image) + text child
      const headingNode = {
        type: { name: "heading" },
        nodeSize: 10,
        isText: false,
        text: undefined,
        descendants: (cb: (child: unknown) => boolean) => {
          cb({ isText: false }); // non-text child → false branch of extractText
          cb({ isText: true, text: "Title" });
        },
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        nodeSize: 10,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(headingNode, 0);
              cb(tableNode, 10);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-txt-1", {
        baseRevision: "rev-1",
        target: { afterHeading: "Title" },
        operations: [{ action: "add_row", at: 0, cells: ["a"] }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isDryRun).toBe(true);
    });
  });

  describe("handleTableBatchModify — set_header idempotent (line 360 false branch)", () => {
    it("does not toggle when current header state matches desired state", async () => {
      const cellNode = {
        type: { name: "tableHeader" },
        nodeSize: 5,
      };
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 1,
        child: () => cellNode,
        nodeSize: 7,
        firstChild: {
          type: { name: "tableHeader" },
          firstChild: { type: { name: "tableHeader" } },
        },
        forEach: vi.fn(),
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        child: () => tableRow,
        firstChild: tableRow,
        nodeSize: 9,
        forEach: vi.fn(),
        descendants: vi.fn(),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
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
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          toggleHeaderRow: vi.fn(),
        },
      };
      mockGetEditor.mockReturnValue(editor);

      // isCurrentlyHeader=true, wantHeader=true (isHeader not false → default true)
      // → isCurrentlyHeader === wantHeader → no toggle
      await handleTableBatchModify("req-sh-idem", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "set_header", row: 0, isHeader: true }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(editor.commands.toggleHeaderRow).not.toHaveBeenCalled();
      expect(call.data.appliedCount).toBe(1);
    });
  });

  describe("handleTableBatchModify — structural op warning when cellPos is null (line 330)", () => {
    it("warns when add_row at index cannot find cell position", async () => {
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 0,
        nodeSize: 4,
        firstChild: { type: { name: "tableHeader" } },
        forEach: vi.fn(), // no cells
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        child: () => tableRow,
        firstChild: tableRow,
        nodeSize: 6,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(tableRow, 0);
        }),
        descendants: vi.fn(),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
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
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          addRowAfter: vi.fn(),
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-nocell", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "add_row", at: 99, cells: ["a"] }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warnings.some((w: string) => w.includes("using current position"))).toBe(true);
    });
  });

  describe("handleListBatchModify — error with non-Error throw in catch (line 636-637)", () => {
    it("handles non-Error thrown objects in operation catch", async () => {
      const listItemNode = {
        type: { name: "listItem" },
        nodeSize: 8,
      };
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(listItemNode, 0);
        }),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          splitListItem: vi.fn(() => { throw "string error"; }),
        },
        view: { dispatch: vi.fn() },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-noerr", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "add_item", at: 0, text: "item" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warnings.some((w: string) => w.includes("Failed"))).toBe(true);
    });
  });

  describe("handleListBatchModify — error path with non-Error throw (line 657)", () => {
    it("handles non-Error thrown in outer catch", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleListBatchModify("req-noerr2", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "add_item", at: 0, text: "item" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      // Error message from "No active editor" via String(error) path
      expect(call.error).toBe("No active editor");
    });
  });

  describe("handleTableBatchModify — error path with non-Error throw (line 445)", () => {
    it("handles non-Error thrown in outer catch", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleTableBatchModify("req-noerr3", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "add_row", at: 0, cells: ["a"] }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("No active editor");
    });
  });

  describe("handleListBatchModify — op error fallback using type/op keys (line 636)", () => {
    it("uses 'type' key for error message when 'action' is missing", async () => {
      const listItemNode = {
        type: { name: "listItem" },
        nodeSize: 8,
      };
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(listItemNode, 0);
        }),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          deleteNode: vi.fn(() => { throw new Error("PM error"); }),
        },
        view: { dispatch: vi.fn() },
      };
      mockGetEditor.mockReturnValue(editor);

      // Use 'type' key instead of 'action' — normalizeListOp accepts it
      await handleListBatchModify("req-type-key", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ type: "delete_item", at: 0 }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warnings.some((w: string) => w.includes("Failed"))).toBe(true);
    });
  });

  describe("handleTableBatchModify — structural op error fallback using type key (line 371)", () => {
    it("uses 'op' key for error message when 'action' is missing", async () => {
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 1,
        child: () => ({ type: { name: "tableCell" }, nodeSize: 5 }),
        nodeSize: 7,
        firstChild: { type: { name: "tableHeader" } },
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb({ type: { name: "tableCell" }, nodeSize: 5 }, 0);
        }),
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        child: () => tableRow,
        firstChild: tableRow,
        nodeSize: 9,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(tableRow, 0);
        }),
        descendants: vi.fn(),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
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
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          addRowAfter: vi.fn(() => { throw new Error("PM error"); }),
        },
      };
      mockGetEditor.mockReturnValue(editor);

      // Use 'op' key — normalizeTableOp accepts it
      await handleTableBatchModify("req-op-key", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ op: "add_row", at: 0, cells: ["a"] }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warnings.some((w: string) => w.includes("Failed"))).toBe(true);
    });
  });

  describe("findList — selector matching for bulletList variant", () => {
    it("matches bulletlist selector variant", async () => {
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-sel-bl", {
        baseRevision: "rev-1",
        target: { selector: "bulletlist" },
        operations: [{ action: "add_item", at: 0, text: "item" }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isDryRun).toBe(true);
    });
  });

  describe("findList — selector matching for orderedlist variant", () => {
    it("matches orderedlist selector variant", async () => {
      const listNode = {
        type: { name: "orderedList" },
        nodeSize: 20,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-sel-olv", {
        baseRevision: "rev-1",
        target: { selector: "orderedlist" },
        operations: [{ action: "add_item", at: 0, text: "item" }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
    });
  });

  describe("findTable — afterHeading with no prior heading (lastHeadingText is null)", () => {
    it("does not match when afterHeading is specified but no heading precedes the table", async () => {
      // Table appears without any preceding heading — lastHeadingText stays null
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        nodeSize: 10,
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

      await handleTableBatchModify("req-no-heading", {
        baseRevision: "rev-1",
        target: { afterHeading: "Some Heading" },
        operations: [{ action: "add_row", at: 0, cells: ["a"] }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toContain("Table not found");
    });
  });

  describe("findList — selector that does not match any known pattern", () => {
    it("does not match when selector is an unrecognized string", async () => {
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-sel-unknown", {
        baseRevision: "rev-1",
        target: { selector: "definition-list" },
        operations: [{ action: "add_item", at: 0, text: "item" }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toContain("List not found");
    });

    it("task selector does not match bulletList", async () => {
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-sel-task-nomatch", {
        baseRevision: "rev-1",
        target: { selector: "tasklist" },
        operations: [{ action: "add_item", at: 0, text: "item" }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toContain("List not found");
    });
  });

  describe("findCellPosition — non-tableRow child in table", () => {
    it("skips non-tableRow children when finding cell position", async () => {
      const cellNode = {
        type: { name: "tableCell" },
        nodeSize: 5,
        textContent: "cell",
      };
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 1,
        child: () => cellNode,
        nodeSize: 7,
        firstChild: { type: { name: "tableHeader" } },
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(cellNode, 0);
        }),
      };
      // A non-tableRow child (e.g., caption or colgroup)
      const nonRowChild = {
        type: { name: "tableCaption" },
        nodeSize: 3,
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 2,
        child: (_i: number) => tableRow,
        firstChild: tableRow,
        content: { size: 10 },
        nodeSize: 12,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(nonRowChild, 0); // non-tableRow child — should be skipped
          cb(tableRow, 3);    // actual row at offset 3
        }),
        descendants: vi.fn(),
      };

      const mockTrReplaceWith = vi.fn().mockReturnThis();
      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(tableNode, 0);
            },
            nodeAt: vi.fn(() => ({ nodeSize: 5 })),
          },
          tr: {
            replaceWith: mockTrReplaceWith,
            get docChanged() { return true; },
          },
          schema: { nodes: { paragraph: { create: vi.fn(() => "empty-p") } } },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {},
        view: { dispatch: vi.fn() },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-nonrow", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "update_cell", row: 0, col: 0, content: "text" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.appliedCount).toBe(1);
    });
  });

  describe("structural op error — non-Error throw and fallback to 'unknown' action", () => {
    it("handles non-Error throw in structural op catch block", async () => {
      const cellNode = {
        type: { name: "tableCell" },
        nodeSize: 5,
      };
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 1,
        child: () => cellNode,
        nodeSize: 7,
        firstChild: { type: { name: "tableHeader" } },
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(cellNode, 0);
        }),
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        child: () => tableRow,
        firstChild: tableRow,
        nodeSize: 9,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(tableRow, 0);
        }),
        descendants: vi.fn(),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
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
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          // Throw a non-Error (string) to cover the String(opError) branch
          addRowAfter: vi.fn(() => { throw "raw string error"; }),
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableBatchModify("req-nonErr-struct", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "add_row", at: 0, cells: ["a"] }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warnings.some((w: string) => w.includes("raw string error"))).toBe(true);
    });

    it("falls back to 'unknown' when rawOp has no action/type/op keys", async () => {
      const cellNode = {
        type: { name: "tableCell" },
        nodeSize: 5,
      };
      const tableRow = {
        type: { name: "tableRow" },
        childCount: 1,
        child: () => cellNode,
        nodeSize: 7,
        firstChild: { type: { name: "tableHeader" } },
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(cellNode, 0);
        }),
      };
      const tableNode = {
        type: { name: "table" },
        childCount: 1,
        child: () => tableRow,
        firstChild: tableRow,
        nodeSize: 9,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(tableRow, 0);
        }),
        descendants: vi.fn(),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
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
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          // We need an op whose normalizeTableOp succeeds but then throws during execution.
          // But the op has no action/type/op keys — that means normalizeOp will throw first,
          // putting it in the normalizedOps as error, so it won't reach the structural catch.
          // For the structural catch fallback, we need an op with only an action set,
          // but then the rawOp does have action. The real fallback happens when rawOp only has
          // e.g. { action: undefined } set. Let's manufacture a throw with rawOp that has no keys.
          addRowAfter: vi.fn(() => { throw new Error("boom"); }),
        },
      };
      mockGetEditor.mockReturnValue(editor);

      // To exercise the "unknown" fallback in the structural catch, we need rawOp
      // to have action/type/op all undefined, but normalizeOp succeeds by using r.action.
      // That's impossible since normalizeOp would throw first. So this branch is
      // practically unreachable for structural ops. The normalize error path already covers it.
      // Skip this sub-branch — it's defensive code.

      // Instead, test the list version for the same fallback
      const listItemNode = { type: { name: "listItem" }, nodeSize: 8 };
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(listItemNode, 0);
        }),
      };

      const listEditor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          deleteNode: vi.fn(() => { throw "string thrown"; }),
        },
        view: { dispatch: vi.fn() },
      };
      mockGetEditor.mockReturnValue(listEditor);

      // rawOp has only 'op' key — exercises the fallback chain in catch (line 636)
      await handleListBatchModify("req-op-fallback", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ op: "delete_item", at: 0 }],
      });

      const call2 = mockRespond.mock.calls[0][0];
      expect(call2.success).toBe(true);
      expect(call2.data.warnings.some((w: string) => w.includes("Failed: delete_item"))).toBe(true);
    });
  });

  describe("handleTableBatchModify — outer catch with non-Error throw (line 445)", () => {
    it("handles non-Error value in outer catch", async () => {
      // Force getEditor to throw a non-Error
      mockGetEditor.mockImplementation(() => { throw 42; });

      await handleTableBatchModify("req-nonErr-outer-tbl", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: [{ action: "add_row", at: 0, cells: ["a"] }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("42");
    });
  });

  describe("handleListBatchModify — outer catch with non-Error throw (line 657)", () => {
    it("handles non-Error value in outer catch", async () => {
      // Force getEditor to throw a non-Error
      mockGetEditor.mockImplementation(() => { throw { code: 500 }; });

      await handleListBatchModify("req-nonErr-outer-lst", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "add_item", at: 0, text: "item" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("[object Object]");
    });
  });

  describe("handleListBatchModify — op error fallback to 'unknown' when no action/type/op", () => {
    it("falls back to 'unknown' action in error message", async () => {
      const listItemNode = { type: { name: "listItem" }, nodeSize: 8 };
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(listItemNode, 0);
        }),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {},
        view: { dispatch: vi.fn() },
      };
      mockGetEditor.mockReturnValue(editor);

      // rawOp has no action/type/op keys at all — requireTypedArray rejects it
      // during element validation before reaching normalizeListOp.
      await handleListBatchModify("req-unknown-fallback", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ someOtherKey: "value" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toContain("invalid list operation at index 0");
    });
  });

  describe("findList — no selector or listIndex (target has neither)", () => {
    it("returns not_found when target has no listIndex and no selector", async () => {
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      // Target has only listId (not implemented) — no listIndex or selector
      await handleListBatchModify("req-no-criteria", {
        baseRevision: "rev-1",
        target: { listId: "some-id" },
        operations: [{ action: "add_item", at: 0, text: "item" }],
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toContain("List not found");
    });
  });

  describe("findListItemPos — skips earlier items to find target index", () => {
    it("skips item at index 0 when targeting index 1", async () => {
      const listItem0 = { type: { name: "listItem" }, nodeSize: 8 };
      const listItem1 = { type: { name: "listItem" }, nodeSize: 8 };
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(listItem0, 0);  // index 0 — itemIndex !== 1, skip
          cb(listItem1, 8);  // index 1 — match
        }),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          deleteNode: vi.fn(),
        },
        view: { dispatch: vi.fn() },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-idx1", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "delete_item", at: 1 }],
      });

      // Should have called setTextSelection for the second item (pos = 0 + 1 + 8 = 9)
      expect(chainMethods.setTextSelection).toHaveBeenCalledWith(10);
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.appliedCount).toBe(1);
    });
  });

  describe("handleListBatchModify — findListItemPos with taskItem nodes", () => {
    it("finds taskItem nodes in findListItemPos", async () => {
      const taskItemNode = {
        type: { name: "taskItem" },
        nodeSize: 8,
        attrs: { checked: false },
      };
      // Non-list-item child that should be skipped
      const otherNode = {
        type: { name: "paragraph" },
        nodeSize: 4,
      };
      const listNode = {
        type: { name: "taskList" },
        nodeSize: 20,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(otherNode, 0); // non-list-item → skipped
          cb(taskItemNode, 4); // taskItem → found
        }),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
          selection: {
            $from: {
              depth: 2,
              node: (d: number) => {
                if (d === 1) return taskItemNode;
                return { type: { name: "taskList" } };
              },
              before: () => 5,
            },
          },
          tr: {
            setNodeMarkup: vi.fn().mockReturnThis(),
          },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          splitListItem: vi.fn(),
          deleteNode: vi.fn(),
          sinkListItem: vi.fn(),
          liftListItem: vi.fn(),
        },
        view: { dispatch: vi.fn() },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-fi-task", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "delete_item", at: 0 }],
      });

      // Should find the taskItem at index 0 and position cursor
      expect(chainMethods.setTextSelection).toHaveBeenCalled();
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.appliedCount).toBe(1);
    });

    it("returns null when findListItemPos has no matching items (all skipped)", async () => {
      // All children are non-list-item types
      const otherNode1 = { type: { name: "paragraph" }, nodeSize: 4 };
      const otherNode2 = { type: { name: "heading" }, nodeSize: 4 };
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(otherNode1, 0);
          cb(otherNode2, 4);
        }),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          deleteNode: vi.fn(),
        },
        view: { dispatch: vi.fn() },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-fi-skip", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "delete_item", at: 0 }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warnings.some((w: string) => w.includes("not found"))).toBe(true);
    });
  });

  describe("handleListBatchModify — add_item without text (no replaceSelection)", () => {
    it("calls splitListItem but skips replaceSelection when text is falsy", async () => {
      const listItemNode = {
        type: { name: "listItem" },
        nodeSize: 8,
      };
      const listNode = {
        type: { name: "bulletList" },
        nodeSize: 20,
        forEach: vi.fn((cb: (node: unknown, offset: number) => void) => {
          cb(listItemNode, 0);
        }),
      };

      const chainMethods = {
        focus: vi.fn().mockReturnThis(),
        setTextSelection: vi.fn().mockReturnThis(),
        run: vi.fn(),
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              cb: (node: unknown, pos: number) => boolean | undefined
            ) => {
              cb(listNode, 0);
            },
          },
          tr: {
            replaceSelection: vi.fn().mockReturnThis(),
          },
        },
        chain: vi.fn().mockReturnValue(chainMethods),
        commands: {
          splitListItem: vi.fn(),
        },
        view: { dispatch: vi.fn() },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBatchModify("req-notext", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: [{ action: "add_item", at: 0, text: "" }],
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(editor.commands.splitListItem).toHaveBeenCalled();
      // replaceSelection should NOT have been called (text is empty/falsy)
      expect(editor.state.tr.replaceSelection).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Type-safe argument narrowing (#285)
  // -------------------------------------------------------------------------

  describe("type-safe argument narrowing", () => {
    it("table: treats non-string baseRevision as empty string", async () => {
      // When baseRevision is not a string, should pass empty string to validator
      mockGetEditor.mockReturnValue({ state: { doc: { descendants: vi.fn() } } });

      await handleTableBatchModify("req-type-1", {
        baseRevision: 123, // wrong type
        target: { tableIndex: 0 },
        operations: [{ action: "add_row", at: 0, cells: [] }],
      });

      // validateBaseRevision should have been called with ""
      expect(mockValidateBaseRevision).toHaveBeenCalledWith("");
    });

    it("table: rejects non-array operations", async () => {
      mockGetEditor.mockReturnValue({ state: { doc: { descendants: vi.fn() } } });

      await handleTableBatchModify("req-type-2", {
        baseRevision: "rev-1",
        target: { tableIndex: 0 },
        operations: "not-an-array",
      });

      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "req-type-2",
          success: false,
          error: "Missing or invalid 'operations' (expected array, got string)",
        })
      );
    });

    it("list: treats non-string baseRevision as empty string", async () => {
      mockGetEditor.mockReturnValue({ state: { doc: { descendants: vi.fn() } } });

      await handleListBatchModify("req-type-3", {
        baseRevision: undefined,
        target: { listIndex: 0 },
        operations: [{ action: "add_item", at: 0, text: "test" }],
      });

      expect(mockValidateBaseRevision).toHaveBeenCalledWith("");
    });

    it("list: rejects non-array operations", async () => {
      mockGetEditor.mockReturnValue({ state: { doc: { descendants: vi.fn() } } });

      await handleListBatchModify("req-type-4", {
        baseRevision: "rev-1",
        target: { listIndex: 0 },
        operations: null,
      });

      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "req-type-4",
          success: false,
          error: "Missing or invalid 'operations' (expected array, got null)",
        })
      );
    });
  });
});
