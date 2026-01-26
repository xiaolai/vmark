/**
 * MCP Bridge - Cursor Handler Tests
 *
 * Tests for cursor.getContext and cursor.setPosition handlers.
 * Block detection tests are in cursorHandlers.block.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleCursorGetContext, handleCursorSetPosition } from "./cursorHandlers";
import {
  createMockNode,
  createMockParentNode,
  createMock$Pos,
  createMockEditor,
} from "./cursorHandlers.testUtils";

// Mock the utils module
vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
}));

import { respond, getEditor } from "./utils";

describe("cursorHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleCursorGetContext", () => {
    it("returns current line, context blocks, and block info for paragraph", async () => {
      const blocks = [
        createMockNode("First paragraph"),
        createMockNode("Second paragraph"),
        createMockNode("Current line"),
        createMockNode("Fourth paragraph"),
        createMockNode("Fifth paragraph"),
      ];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: blocks[2],
        depth: 1,
        blockIndex: 2,
        parentNode,
      });
      const editor = createMockEditor({ from: 50, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-1", { linesBefore: 2, linesAfter: 2 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: {
          before: "First paragraph\nSecond paragraph",
          after: "Fourth paragraph\nFifth paragraph",
          currentLine: "Current line",
          currentParagraph: "Current line",
          block: {
            type: "paragraph",
            position: 10,
          },
        },
      });
    });

    it("uses default linesBefore=5 and linesAfter=5 when not specified", async () => {
      const blocks = [
        createMockNode("Line 1"),
        createMockNode("Line 2"),
        createMockNode("Current"),
        createMockNode("Line 4"),
      ];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: blocks[2],
        depth: 1,
        blockIndex: 2,
        parentNode,
      });
      const editor = createMockEditor({ from: 20, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-2", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-2",
        success: true,
        data: {
          before: "Line 1\nLine 2",
          after: "Line 4",
          currentLine: "Current",
          currentParagraph: "Current",
          block: {
            type: "paragraph",
            position: 10,
          },
        },
      });
    });

    it("handles cursor at first block (no before context)", async () => {
      const blocks = [
        createMockNode("First line"),
        createMockNode("Second line"),
      ];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: blocks[0],
        depth: 1,
        blockIndex: 0,
        parentNode,
      });
      const editor = createMockEditor({ from: 5, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-3", { linesBefore: 5, linesAfter: 5 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-3",
        success: true,
        data: {
          before: "",
          after: "Second line",
          currentLine: "First line",
          currentParagraph: "First line",
          block: {
            type: "paragraph",
            position: 10,
          },
        },
      });
    });

    it("handles cursor at last block (no after context)", async () => {
      const blocks = [
        createMockNode("First line"),
        createMockNode("Last line"),
      ];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: blocks[1],
        depth: 1,
        blockIndex: 1,
        parentNode,
      });
      const editor = createMockEditor({ from: 20, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-4", { linesBefore: 5, linesAfter: 5 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-4",
        success: true,
        data: {
          before: "First line",
          after: "",
          currentLine: "Last line",
          currentParagraph: "Last line",
          block: {
            type: "paragraph",
            position: 10,
          },
        },
      });
    });

    it("handles single block document", async () => {
      const blocks = [createMockNode("Only paragraph")];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: blocks[0],
        depth: 1,
        blockIndex: 0,
        parentNode,
      });
      const editor = createMockEditor({ from: 5, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-5", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-5",
        success: true,
        data: {
          before: "",
          after: "",
          currentLine: "Only paragraph",
          currentParagraph: "Only paragraph",
          block: {
            type: "paragraph",
            position: 10,
          },
        },
      });
    });

    it("returns error when no editor is available", async () => {
      vi.mocked(getEditor).mockReturnValue(null);

      await handleCursorGetContext("req-6", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-6",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleCursorSetPosition", () => {
    it("sets cursor position via setTextSelection", async () => {
      const setTextSelection = vi.fn();
      const editor = {
        state: { selection: { from: 0 }, doc: {} },
        commands: { setTextSelection },
      };

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorSetPosition("req-10", { position: 42 });

      expect(setTextSelection).toHaveBeenCalledWith(42);
      expect(respond).toHaveBeenCalledWith({
        id: "req-10",
        success: true,
        data: null,
      });
    });

    it("returns error when no editor is available", async () => {
      vi.mocked(getEditor).mockReturnValue(null);

      await handleCursorSetPosition("req-11", { position: 10 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-11",
        success: false,
        error: "No active editor",
      });
    });
  });
});
