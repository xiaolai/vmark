/**
 * Tests for selectionHandlers — selection.get and selection.set.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils before importing handlers
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
}));

import { handleSelectionGet, handleSelectionSet } from "../selectionHandlers";

describe("selectionHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleSelectionGet", () => {
    it("returns selection text and range", async () => {
      const editor = {
        state: {
          selection: { from: 5, to: 10 },
          doc: {
            textBetween: vi.fn().mockReturnValue("hello"),
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleSelectionGet("req-1");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: {
          text: "hello",
          range: { from: 5, to: 10 },
          isEmpty: false,
        },
      });
    });

    it("reports empty selection when from equals to", async () => {
      const editor = {
        state: {
          selection: { from: 5, to: 5 },
          doc: {
            textBetween: vi.fn().mockReturnValue(""),
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleSelectionGet("req-2");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-2",
        success: true,
        data: {
          text: "",
          range: { from: 5, to: 5 },
          isEmpty: true,
        },
      });
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleSelectionGet("req-3");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-3",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleSelectionSet", () => {
    it("sets text selection with from/to", async () => {
      const setTextSelection = vi.fn();
      const editor = {
        state: { selection: { from: 0 }, doc: {} },
        commands: { setTextSelection },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleSelectionSet("req-4", { from: 10, to: 20 });

      expect(setTextSelection).toHaveBeenCalledWith({ from: 10, to: 20 });
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-4",
        success: true,
        data: null,
      });
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleSelectionSet("req-5", { from: 0, to: 5 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: "No active editor",
      });
    });
  });
});
