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
        state: { selection: { from: 0 }, doc: { content: { size: 100 } } },
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

    it("rejects negative position with a clear error", async () => {
      const setTextSelection = vi.fn();
      const editor = {
        state: { selection: { from: 0 }, doc: { content: { size: 100 } } },
        commands: { setTextSelection },
      };

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorSetPosition("req-neg", { position: -1 });

      expect(setTextSelection).not.toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-neg",
        success: false,
        error: "Invalid position: -1 (document size: 100)",
      });
    });

    it("rejects position beyond document size with a clear error", async () => {
      const setTextSelection = vi.fn();
      const editor = {
        state: { selection: { from: 0 }, doc: { content: { size: 100 } } },
        commands: { setTextSelection },
      };

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorSetPosition("req-over", { position: 1_000_000_000 });

      expect(setTextSelection).not.toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-over",
        success: false,
        error: "Invalid position: 1000000000 (document size: 100)",
      });
    });

    it("accepts position equal to document size (end of document)", async () => {
      const setTextSelection = vi.fn();
      const editor = {
        state: { selection: { from: 0 }, doc: { content: { size: 100 } } },
        commands: { setTextSelection },
      };

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorSetPosition("req-edge", { position: 100 });

      expect(setTextSelection).toHaveBeenCalledWith(100);
      expect(respond).toHaveBeenCalledWith({
        id: "req-edge",
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

    it("handles non-Error thrown value", async () => {
      vi.mocked(getEditor).mockImplementation(() => {
        throw "raw string error";
      });

      await handleCursorSetPosition("req-str-1", { position: 10 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-str-1",
        success: false,
        error: "raw string error",
      });
    });
  });

  describe("createMock$Pos — node() fallback to options.parent (line 57)", () => {
    it("returns options.parent when depth > 0 but ancestorIndex is out of bounds (line 57)", async () => {
      // createMock$Pos.node(depth) returns options.parent when:
      //   ancestorIndex >= ancestors.length (uncovered — line 57 fallback)
      // With depth=2 and ancestors=[] (empty):
      //   node(1): ancestorIndex = 2-1-1 = 0, ancestors.length=0 → 0 >= 0 is true but
      //   0 < 0 is false → condition fails → falls through to return options.parent (line 57).
      const paraNode = createMockNode("Content", "paragraph");
      const blocks = [paraNode];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: paraNode,
        depth: 2,
        blockIndex: 0,
        parentNode,
        ancestors: [],  // empty — triggers the out-of-bounds fallback at line 57
      });
      const editor = createMockEditor({ from: 5, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-fallback", {});

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ id: "req-fallback", success: true })
      );
    });

    it("index() returns 0 when depth !== 1 (line 49 else branch)", async () => {
      // createMock$Pos.index() returns blockIndex when depth===1, else 0.
      // handleCursorGetContext calls $pos.index(blockDepth) where blockDepth = $pos.depth > 0 ? 1 : 0.
      // When $pos.depth === 0: blockDepth=0 → $pos.index(0) → depth!==1 → returns 0 (line 49 else).
      const paraNode = createMockNode("Only block", "paragraph");
      const blocks = [paraNode];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: paraNode,
        depth: 0,       // depth=0 → blockDepth=0 → index(0) uses else branch
        blockIndex: 99, // unused since depth!==1 path returns 0
        parentNode,
      });
      // Use the default index() implementation (do NOT override it)
      const editor = createMockEditor({ from: 0, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-index-else", {});

      // Should succeed without error
      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ id: "req-index-else", success: true })
      );
    });
  });

  describe("handleCursorGetContext — edge cases", () => {
    it("handles depth=0 (blockDepth fallback)", async () => {
      const blocks = [createMockNode("Root text")];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: blocks[0],
        depth: 0,
        blockIndex: 0,
        parentNode,
      });
      // Override index to handle depth=0 case
      $pos.index = (depth: number) => (depth === 0 ? 0 : 0);
      const editor = createMockEditor({ from: 0, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-depth0", {});

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "req-depth0",
          success: true,
        })
      );
    });

    it("handles non-Error thrown value in getContext", async () => {
      vi.mocked(getEditor).mockImplementation(() => {
        throw "context error";
      });

      await handleCursorGetContext("req-str-2", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-str-2",
        success: false,
        error: "context error",
      });
    });
  });
});
