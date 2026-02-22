/**
 * MCP Bridge — Batch Operation Handler Tests
 *
 * Tests for table.batchModify and list.batchModify handlers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
  isAutoApproveEnabled: vi.fn(() => true),
}));

vi.mock("./revisionTracker", () => ({
  validateBaseRevision: vi.fn(() => null),
  getCurrentRevision: vi.fn(() => "rev-new"),
}));

vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  createMarkdownPasteSlice: vi.fn(() => ({ content: { size: 5 } })),
}));

import { handleTableBatchModify, handleListBatchModify } from "./batchOpHandlers";
import { respond, getEditor, isAutoApproveEnabled } from "./utils";
import { validateBaseRevision } from "./revisionTracker";

// ---------------------------------------------------------------------------
// Mock editor factories
// ---------------------------------------------------------------------------

function createMockEditorWithTable(opts: { rows?: number; cols?: number } = {}) {
  const { cols = 3 } = opts;

  const tableNode = {
    type: { name: "table" },
    nodeSize: 100,
    firstChild: {
      type: { name: "tableRow" },
      firstChild: { type: { name: "tableHeader" } },
      childCount: cols,
    },
    forEach: vi.fn(),
  };

  const mockChain = {
    focus: vi.fn().mockReturnThis(),
    setTextSelection: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };

  return {
    state: {
      doc: {
        descendants: vi.fn((cb: (node: unknown, pos: number) => boolean | void) => {
          cb(tableNode, 10);
        }),
        nodeAt: vi.fn(() => ({ nodeSize: 10 })),
      },
      tr: { replaceWith: vi.fn().mockReturnThis(), docChanged: false },
      schema: { nodes: { paragraph: { create: vi.fn() } } },
    },
    view: { dispatch: vi.fn() },
    chain: vi.fn(() => mockChain),
    commands: {
      addRowAfter: vi.fn(),
      deleteRow: vi.fn(),
      addColumnAfter: vi.fn(),
      deleteColumn: vi.fn(),
      toggleHeaderRow: vi.fn(),
      splitListItem: vi.fn(),
      deleteNode: vi.fn(),
      sinkListItem: vi.fn(),
      liftListItem: vi.fn(),
    },
  };
}

function createMockEditorWithList(listType = "bulletList") {
  const listNode = {
    type: { name: listType },
    nodeSize: 50,
    forEach: vi.fn((cb: (child: unknown, offset: number) => void) => {
      // Simulate a single list item so findListItemPos can resolve index 0
      cb({ type: { name: "listItem" }, nodeSize: 20 }, 0);
    }),
  };

  const mockChain = {
    focus: vi.fn().mockReturnThis(),
    setTextSelection: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };

  return {
    state: {
      doc: {
        descendants: vi.fn((cb: (node: unknown, pos: number) => boolean | void) => {
          cb(listNode, 5);
        }),
      },
      tr: { replaceSelection: vi.fn().mockReturnThis() },
      selection: {
        $from: {
          depth: 2,
          node: vi.fn((d: number) => {
            if (d === 1) return { type: { name: "taskItem" }, attrs: { checked: false } };
            return { type: { name: "doc" } };
          }),
          before: vi.fn(() => 10),
        },
      },
    },
    view: { dispatch: vi.fn() },
    chain: vi.fn(() => mockChain),
    commands: {
      splitListItem: vi.fn(),
      deleteNode: vi.fn(),
      sinkListItem: vi.fn(),
      liftListItem: vi.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Shared args helpers
// ---------------------------------------------------------------------------

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    baseRevision: "rev-1",
    target: { tableIndex: 0 },
    operations: [{ action: "add_row", at: 0, cells: ["a", "b"] }],
    ...overrides,
  };
}

function listBaseArgs(overrides: Record<string, unknown> = {}) {
  return {
    baseRevision: "rev-1",
    target: { listIndex: 0 },
    operations: [{ action: "add_item", at: 0, text: "new item" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleTableBatchModify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateBaseRevision).mockReturnValue(null);
    vi.mocked(isAutoApproveEnabled).mockReturnValue(true);
  });

  it("returns revision conflict error", async () => {
    vi.mocked(validateBaseRevision).mockReturnValue({
      error: "Revision conflict: document has changed. Expected rev-old, current is rev-2",
      currentRevision: "rev-2",
    });
    vi.mocked(getEditor).mockReturnValue(createMockEditorWithTable() as never);

    await handleTableBatchModify("req-1", baseArgs());

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "Revision conflict: document has changed. Expected rev-old, current is rev-2",
      data: { code: "conflict", currentRevision: "rev-2" },
    });
  });

  it("returns error when no editor", async () => {
    vi.mocked(getEditor).mockReturnValue(null as never);

    await handleTableBatchModify("req-1", baseArgs());

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "No active editor",
    });
  });

  it("returns error when target missing", async () => {
    vi.mocked(getEditor).mockReturnValue(createMockEditorWithTable() as never);

    await handleTableBatchModify("req-1", baseArgs({ target: undefined }));

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "target is required",
    });
  });

  it("returns error when operations empty", async () => {
    vi.mocked(getEditor).mockReturnValue(createMockEditorWithTable() as never);

    await handleTableBatchModify("req-1", baseArgs({ operations: [] }));

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "At least one operation is required",
    });
  });

  it("returns not_found when table missing", async () => {
    const editor = createMockEditorWithTable();
    // No table found by descendants
    editor.state.doc.descendants.mockImplementation(() => {});
    vi.mocked(getEditor).mockReturnValue(editor as never);

    await handleTableBatchModify("req-1", baseArgs());

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "Table not found",
      data: { code: "not_found" },
    });
  });

  it("returns dryRun preview", async () => {
    vi.mocked(getEditor).mockReturnValue(createMockEditorWithTable() as never);

    await handleTableBatchModify(
      "req-1",
      baseArgs({ mode: "dryRun", operations: [{ action: "add_row", at: 0, cells: [] }] })
    );

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: true,
      data: {
        success: true,
        preview: {
          tablePosition: 10,
          operationCount: 1,
          operations: ["add_row"],
        },
        isDryRun: true,
      },
    });
  });

  it("returns suggest mode warning", async () => {
    vi.mocked(isAutoApproveEnabled).mockReturnValue(false);
    vi.mocked(getEditor).mockReturnValue(createMockEditorWithTable() as never);

    await handleTableBatchModify("req-1", baseArgs());

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: true,
      data: {
        success: false,
        warning:
          "Table batch operations in suggest mode not yet supported. Use mode='apply' or enable auto-approve.",
        operationCount: 1,
      },
    });
  });

  it("applies add_row operation", async () => {
    const editor = createMockEditorWithTable();
    vi.mocked(getEditor).mockReturnValue(editor as never);

    await handleTableBatchModify("req-1", baseArgs({ operations: [{ action: "add_row", at: 0, cells: ["a"] }] }));

    expect(editor.commands.addRowAfter).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ id: "req-1", success: true })
    );
  });

  it("applies delete_row operation", async () => {
    const editor = createMockEditorWithTable();
    vi.mocked(getEditor).mockReturnValue(editor as never);

    await handleTableBatchModify("req-1", baseArgs({ operations: [{ action: "delete_row", at: 0 }] }));

    expect(editor.commands.deleteRow).toHaveBeenCalled();
  });

  it("applies add_column operation", async () => {
    const editor = createMockEditorWithTable();
    vi.mocked(getEditor).mockReturnValue(editor as never);

    await handleTableBatchModify(
      "req-1",
      baseArgs({ operations: [{ action: "add_column", at: 0, header: "H", cells: [] }] })
    );

    expect(editor.commands.addColumnAfter).toHaveBeenCalled();
  });

  it("applies delete_column operation", async () => {
    const editor = createMockEditorWithTable();
    vi.mocked(getEditor).mockReturnValue(editor as never);

    await handleTableBatchModify("req-1", baseArgs({ operations: [{ action: "delete_column", at: 0 }] }));

    expect(editor.commands.deleteColumn).toHaveBeenCalled();
  });

  it("warns on unknown table operation", async () => {
    const editor = createMockEditorWithTable();
    vi.mocked(getEditor).mockReturnValue(editor as never);

    await handleTableBatchModify(
      "req-1",
      baseArgs({ operations: [{ action: "flip_table", at: 0 }] })
    );

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          warnings: expect.arrayContaining([expect.stringContaining("Unknown table operation: flip_table")]),
        }),
      })
    );
  });
});

describe("handleListBatchModify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateBaseRevision).mockReturnValue(null);
    vi.mocked(isAutoApproveEnabled).mockReturnValue(true);
  });

  it("returns revision conflict error", async () => {
    vi.mocked(validateBaseRevision).mockReturnValue({
      error: "baseRevision is required for mutations",
      currentRevision: "rev-2",
    });
    vi.mocked(getEditor).mockReturnValue(createMockEditorWithList() as never);

    await handleListBatchModify("req-1", listBaseArgs());

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "baseRevision is required for mutations",
      data: { code: "conflict", currentRevision: "rev-2" },
    });
  });

  it("returns error when no editor", async () => {
    vi.mocked(getEditor).mockReturnValue(null as never);

    await handleListBatchModify("req-1", listBaseArgs());

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "No active editor",
    });
  });

  it("returns error when target missing", async () => {
    vi.mocked(getEditor).mockReturnValue(createMockEditorWithList() as never);

    await handleListBatchModify("req-1", listBaseArgs({ target: undefined }));

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "target is required",
    });
  });

  it("returns error when operations empty", async () => {
    vi.mocked(getEditor).mockReturnValue(createMockEditorWithList() as never);

    await handleListBatchModify("req-1", listBaseArgs({ operations: [] }));

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "At least one operation is required",
    });
  });

  it("returns not_found when list missing", async () => {
    const editor = createMockEditorWithList();
    editor.state.doc.descendants.mockImplementation(() => {});
    vi.mocked(getEditor).mockReturnValue(editor as never);

    await handleListBatchModify("req-1", listBaseArgs());

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "List not found",
      data: { code: "not_found" },
    });
  });

  it("returns dryRun preview", async () => {
    vi.mocked(getEditor).mockReturnValue(createMockEditorWithList() as never);

    await handleListBatchModify(
      "req-1",
      listBaseArgs({ mode: "dryRun", operations: [{ action: "add_item", at: 0, text: "x" }] })
    );

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: true,
      data: {
        success: true,
        preview: {
          listPosition: 5,
          listType: "bulletList",
          operationCount: 1,
          operations: ["add_item"],
        },
        isDryRun: true,
      },
    });
  });

  it("returns suggest mode warning", async () => {
    vi.mocked(isAutoApproveEnabled).mockReturnValue(false);
    vi.mocked(getEditor).mockReturnValue(createMockEditorWithList() as never);

    await handleListBatchModify("req-1", listBaseArgs());

    expect(respond).toHaveBeenCalledWith({
      id: "req-1",
      success: true,
      data: {
        success: false,
        warning:
          "List batch operations in suggest mode not yet supported. Use mode='apply' or enable auto-approve.",
        operationCount: 1,
      },
    });
  });

  it("applies add_item operation", async () => {
    const editor = createMockEditorWithList();
    vi.mocked(getEditor).mockReturnValue(editor as never);

    await handleListBatchModify(
      "req-1",
      listBaseArgs({ operations: [{ action: "add_item", at: 0, text: "new" }] })
    );

    expect(editor.commands.splitListItem).toHaveBeenCalledWith("listItem");
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ id: "req-1", success: true })
    );
  });

  it("applies delete_item operation", async () => {
    const editor = createMockEditorWithList();
    vi.mocked(getEditor).mockReturnValue(editor as never);

    await handleListBatchModify("req-1", listBaseArgs({ operations: [{ action: "delete_item", at: 0 }] }));

    expect(editor.commands.deleteNode).toHaveBeenCalledWith("listItem");
  });

  it("applies set_indent increase", async () => {
    const editor = createMockEditorWithList();
    vi.mocked(getEditor).mockReturnValue(editor as never);

    await handleListBatchModify(
      "req-1",
      listBaseArgs({ operations: [{ action: "set_indent", at: 0, indent: 1 }] })
    );

    expect(editor.commands.sinkListItem).toHaveBeenCalledWith("listItem");
  });

  it("applies set_indent decrease", async () => {
    const editor = createMockEditorWithList();
    vi.mocked(getEditor).mockReturnValue(editor as never);

    await handleListBatchModify(
      "req-1",
      listBaseArgs({ operations: [{ action: "set_indent", at: 0, indent: 0 }] })
    );

    expect(editor.commands.liftListItem).toHaveBeenCalledWith("listItem");
  });

  it("warns on unknown list operation", async () => {
    const editor = createMockEditorWithList();
    vi.mocked(getEditor).mockReturnValue(editor as never);

    await handleListBatchModify(
      "req-1",
      listBaseArgs({ operations: [{ action: "shuffle_items", at: 0 }] })
    );

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          warnings: expect.arrayContaining([
            expect.stringContaining("Unknown list operation: shuffle_items"),
          ]),
        }),
      })
    );
  });
});
