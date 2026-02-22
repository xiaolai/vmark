/**
 * MCP Bridge — Table Handler Tests
 *
 * Tests for table.insert and table.delete handlers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleTableInsert, handleTableDelete } from "./tableHandlers";

vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
}));

import { respond, getEditor } from "./utils";

function createMockEditor(options: { insertSuccess?: boolean } = {}) {
  const { insertSuccess = true } = options;
  return {
    commands: {
      insertTable: vi.fn(() => insertSuccess),
      deleteTable: vi.fn(),
    },
    state: {
      selection: {
        $from: {
          depth: 2,
          node: vi.fn((d: number) => {
            if (d === 1) {
              return {
                type: { name: "table" },
                firstChild: { childCount: 3 },
              };
            }
            return { type: { name: "doc" }, firstChild: null };
          }),
        },
      },
    },
  };
}

describe("tableHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleTableInsert", () => {
    it("inserts table with rows and cols", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleTableInsert("req-1", { rows: 3, cols: 3, withHeaderRow: true });

      expect(editor.commands.insertTable).toHaveBeenCalledWith({
        rows: 3,
        cols: 3,
        withHeaderRow: true,
      });
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({ rows: 3, cols: 3, withHeaderRow: true }),
      });
    });

    it("defaults withHeaderRow to true", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleTableInsert("req-1", { rows: 2, cols: 2 });

      expect(editor.commands.insertTable).toHaveBeenCalledWith({
        rows: 2,
        cols: 2,
        withHeaderRow: true,
      });
    });

    it("returns error for non-finite rows", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleTableInsert("req-1", { rows: NaN, cols: 2 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "rows and cols must be finite numbers",
      });
    });

    it("returns error for non-integer rows", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleTableInsert("req-1", { rows: 2.5, cols: 2 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "rows and cols must be integers (no decimals)",
      });
    });

    it("returns error for rows < 1", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleTableInsert("req-1", { rows: 0, cols: 2 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "rows must be at least 1",
      });
    });

    it("returns error for cols < 1", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleTableInsert("req-1", { rows: 2, cols: 0 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "cols must be at least 1",
      });
    });

    it("returns error when insertTable fails", async () => {
      const editor = createMockEditor({ insertSuccess: false });
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleTableInsert("req-1", { rows: 2, cols: 2 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "insertTable failed — cursor may not be in a valid position",
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleTableInsert("req-1", { rows: 2, cols: 2 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleTableDelete", () => {
    it("deletes table", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleTableDelete("req-1");

      expect(editor.commands.deleteTable).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleTableDelete("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });
});
