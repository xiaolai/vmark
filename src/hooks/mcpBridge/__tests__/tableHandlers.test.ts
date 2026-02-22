/**
 * Tests for tableHandlers — table.insert and table.delete.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
}));

import { handleTableInsert, handleTableDelete } from "../tableHandlers";

describe("tableHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleTableInsert", () => {
    it("inserts table with rows and cols", async () => {
      const insertTable = vi.fn().mockReturnValue(true);
      const tableNode = {
        type: { name: "table" },
        firstChild: { childCount: 3 },
      };
      const editor = {
        commands: { insertTable },
        state: {
          selection: {
            $from: {
              depth: 2,
              node: (d: number) =>
                d === 2 ? tableNode : { type: { name: "doc" } },
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleTableInsert("req-1", { rows: 3, cols: 3 });

      expect(insertTable).toHaveBeenCalledWith({
        rows: 3,
        cols: 3,
        withHeaderRow: true,
      });
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.rows).toBe(3);
      expect(call.data.cols).toBe(3);
    });

    it("returns error for non-finite rows/cols", async () => {
      mockGetEditor.mockReturnValue({ commands: {} });

      await handleTableInsert("req-2", { rows: NaN, cols: 3 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-2",
        success: false,
        error: "rows and cols must be finite numbers",
      });
    });

    it("returns error for decimal rows/cols", async () => {
      mockGetEditor.mockReturnValue({ commands: {} });

      await handleTableInsert("req-2b", { rows: 2.5, cols: 3 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-2b",
        success: false,
        error: "rows and cols must be integers (no decimals)",
      });
    });

    it("returns error for rows less than 1", async () => {
      mockGetEditor.mockReturnValue({ commands: {} });

      await handleTableInsert("req-3", { rows: 0, cols: 3 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-3",
        success: false,
        error: "rows must be at least 1",
      });
    });

    it("returns error for cols less than 1", async () => {
      mockGetEditor.mockReturnValue({ commands: {} });

      await handleTableInsert("req-4", { rows: 3, cols: 0 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-4",
        success: false,
        error: "cols must be at least 1",
      });
    });

    it("returns error when insertTable fails", async () => {
      const insertTable = vi.fn().mockReturnValue(false);
      mockGetEditor.mockReturnValue({ commands: { insertTable } });

      await handleTableInsert("req-5", { rows: 2, cols: 2 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: expect.stringContaining("insertTable failed"),
      });
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleTableInsert("req-6", { rows: 2, cols: 2 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-6",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleTableDelete", () => {
    it("deletes table", async () => {
      const deleteTable = vi.fn();
      mockGetEditor.mockReturnValue({ commands: { deleteTable } });

      await handleTableDelete("req-7");

      expect(deleteTable).toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-7",
        success: true,
        data: null,
      });
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleTableDelete("req-8");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-8",
        success: false,
        error: "No active editor",
      });
    });
  });
});
