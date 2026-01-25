/**
 * MCP Bridge - Cursor Handler Tests
 *
 * Tests for cursor.getContext and cursor.setPosition handlers.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { handleCursorGetContext, handleCursorSetPosition } from "./cursorHandlers";

// Mock the utils module
vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
}));

import { respond, getEditor } from "./utils";

/**
 * Create a mock ProseMirror node with textContent.
 */
function createMockNode(textContent: string) {
  return { textContent };
}

/**
 * Create a mock parent node with children.
 */
function createMockParentNode(children: { textContent: string }[]) {
  return {
    childCount: children.length,
    child: (index: number) => children[index],
  };
}

/**
 * Create a mock $pos (resolved position) object.
 */
function createMock$Pos(options: {
  parent: { textContent: string };
  depth: number;
  blockIndex: number;
  parentNode: ReturnType<typeof createMockParentNode>;
}) {
  return {
    parent: options.parent,
    depth: options.depth,
    index: (depth: number) => (depth === 1 ? options.blockIndex : 0),
    node: (depth: number) => (depth === 0 ? options.parentNode : options.parent),
  };
}

/**
 * Create a mock editor with document state.
 */
function createMockEditor(options: {
  from: number;
  $pos: ReturnType<typeof createMock$Pos>;
  doc: ReturnType<typeof createMockParentNode>;
}) {
  return {
    state: {
      selection: { from: options.from },
      doc: {
        ...options.doc,
        resolve: () => options.$pos,
      },
    },
    commands: {
      setTextSelection: vi.fn(),
    },
  };
}

describe("cursorHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleCursorGetContext", () => {
    it("returns current line and context blocks", async () => {
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

    it("uses top-level block context when cursor is in nested structure (list)", async () => {
      // Simulates cursor inside a list item at depth 2
      // The implementation uses blockDepth=1 for consistent "line" semantics
      const blocks = [
        createMockNode("Paragraph before"),
        createMockNode("List item content"), // This is the list block at depth 1
        createMockNode("Paragraph after"),
      ];
      const parentNode = createMockParentNode(blocks);
      const listItemNode = createMockNode("List item content");
      const $pos = {
        parent: listItemNode, // Cursor's immediate parent is the list item
        depth: 2, // Nested inside list
        index: (depth: number) => (depth === 1 ? 1 : 0), // Block index at depth 1
        node: (depth: number) => (depth === 0 ? parentNode : listItemNode),
      };
      const editor = createMockEditor({ from: 30, $pos: $pos as never, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-7", { linesBefore: 1, linesAfter: 1 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-7",
        success: true,
        data: {
          before: "Paragraph before",
          after: "Paragraph after",
          currentLine: "List item content",
          currentParagraph: "List item content",
        },
      });
    });

    it("uses top-level block context when cursor is in blockquote", async () => {
      // Simulates cursor inside a blockquote paragraph at depth 2
      const blocks = [
        createMockNode("Before quote"),
        createMockNode("Quoted text"), // Blockquote block at depth 1
        createMockNode("After quote"),
      ];
      const parentNode = createMockParentNode(blocks);
      const quoteParagraph = createMockNode("Quoted text");
      const $pos = {
        parent: quoteParagraph,
        depth: 2, // Inside blockquote > paragraph
        index: (depth: number) => (depth === 1 ? 1 : 0),
        node: (depth: number) => (depth === 0 ? parentNode : quoteParagraph),
      };
      const editor = createMockEditor({ from: 25, $pos: $pos as never, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-8", { linesBefore: 1, linesAfter: 1 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-8",
        success: true,
        data: {
          before: "Before quote",
          after: "After quote",
          currentLine: "Quoted text",
          currentParagraph: "Quoted text",
        },
      });
    });

    it("handles cursor at document root (depth 0)", async () => {
      // Edge case: cursor at depth 0 (e.g., empty document or start of doc)
      // When depth=0, blockDepth=0, parent is doc itself which may not have textContent
      const blocks = [createMockNode("Only content")];
      const parentNode = createMockParentNode(blocks);
      const $pos = {
        parent: parentNode, // Parent is the doc itself (no textContent property)
        depth: 0,
        index: () => 0,
        node: () => parentNode,
      };
      const editor = {
        state: {
          selection: { from: 0 },
          doc: {
            ...parentNode,
            resolve: () => $pos,
          },
        },
        commands: { setTextSelection: vi.fn() },
      };

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-9", {});

      // When depth=0, blockDepth=0, uses doc as parent - currentLine is undefined
      // because doc node doesn't have textContent like block nodes do
      expect(respond).toHaveBeenCalledWith({
        id: "req-9",
        success: true,
        data: {
          before: "",
          after: "",
          currentLine: undefined,
          currentParagraph: undefined,
        },
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
