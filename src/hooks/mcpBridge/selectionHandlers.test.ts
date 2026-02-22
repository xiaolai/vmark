/**
 * MCP Bridge — Selection Handler Tests
 *
 * Tests for selection.get and selection.set handlers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleSelectionGet, handleSelectionSet } from "./selectionHandlers";

vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
}));

import { respond, getEditor } from "./utils";

describe("selectionHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleSelectionGet", () => {
    it("returns selection text and range", async () => {
      vi.mocked(getEditor).mockReturnValue({
        state: {
          selection: { from: 5, to: 10 },
          doc: {
            textBetween: vi.fn(() => "world"),
          },
        },
      } as never);

      await handleSelectionGet("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: {
          text: "world",
          range: { from: 5, to: 10 },
          isEmpty: false,
        },
      });
    });

    it("returns isEmpty=true when cursor with no selection", async () => {
      vi.mocked(getEditor).mockReturnValue({
        state: {
          selection: { from: 5, to: 5 },
          doc: {
            textBetween: vi.fn(() => ""),
          },
        },
      } as never);

      await handleSelectionGet("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: {
          text: "",
          range: { from: 5, to: 5 },
          isEmpty: true,
        },
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleSelectionGet("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleSelectionSet", () => {
    it("sets text selection", async () => {
      const setTextSelection = vi.fn();
      vi.mocked(getEditor).mockReturnValue({
        commands: { setTextSelection },
      } as never);

      await handleSelectionSet("req-1", { from: 0, to: 10 });

      expect(setTextSelection).toHaveBeenCalledWith({ from: 0, to: 10 });
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleSelectionSet("req-1", { from: 0, to: 10 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });
});
