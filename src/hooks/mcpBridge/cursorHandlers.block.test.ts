/**
 * MCP Bridge - Cursor Handler Block Detection Tests
 *
 * Tests for block type detection and container identification in cursor.getContext.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleCursorGetContext } from "./cursorHandlers";
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

describe("cursorHandlers - block detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("block type detection", () => {
    it("returns heading level for heading blocks", async () => {
      const headingNode = createMockNode("My Heading", "heading", { level: 2 });
      const blocks = [headingNode, createMockNode("Paragraph after")];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: headingNode,
        depth: 1,
        blockIndex: 0,
        parentNode,
      });
      const editor = createMockEditor({ from: 5, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-heading", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-heading",
        success: true,
        data: {
          before: "",
          after: "Paragraph after",
          currentLine: "My Heading",
          currentParagraph: "My Heading",
          block: {
            type: "heading",
            level: 2,
            position: 10,
          },
        },
      });
    });

    it("returns language for code blocks", async () => {
      const codeNode = createMockNode("const x = 1;", "codeBlock", { language: "typescript" });
      const blocks = [createMockNode("Before"), codeNode];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: codeNode,
        depth: 1,
        blockIndex: 1,
        parentNode,
      });
      const editor = createMockEditor({ from: 20, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-code", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-code",
        success: true,
        data: {
          before: "Before",
          after: "",
          currentLine: "const x = 1;",
          currentParagraph: "const x = 1;",
          block: {
            type: "codeBlock",
            language: "typescript",
            position: 10,
          },
        },
      });
    });

    it("omits language when code block has no language set", async () => {
      const codeNode = createMockNode("plain code", "codeBlock", { language: "" });
      const blocks = [codeNode];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: codeNode,
        depth: 1,
        blockIndex: 0,
        parentNode,
      });
      const editor = createMockEditor({ from: 5, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-code-no-lang", {});

      const call = vi.mocked(respond).mock.calls[0][0] as { data: { block: { type: string; language?: string } } };
      expect(call.data.block.type).toBe("codeBlock");
      expect(call.data.block.language).toBeUndefined();
    });
  });

  describe("list container detection", () => {
    it("detects bullet list container", async () => {
      const listItemNode = createMockNode("List item", "paragraph");
      const blocks = [createMockNode("Before"), listItemNode];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: listItemNode,
        depth: 3, // doc > bulletList > listItem > paragraph
        blockIndex: 1,
        parentNode,
        ancestors: [
          { name: "bulletList" },
          { name: "listItem" },
        ],
      });
      const editor = createMockEditor({ from: 30, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-bullet", {});

      const call = vi.mocked(respond).mock.calls[0][0] as { data: { block: { inList: string } } };
      expect(call.data.block.inList).toBe("bullet");
    });

    it("detects ordered list container", async () => {
      const listItemNode = createMockNode("Item 1", "paragraph");
      const blocks = [listItemNode];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: listItemNode,
        depth: 3,
        blockIndex: 0,
        parentNode,
        ancestors: [
          { name: "orderedList" },
          { name: "listItem" },
        ],
      });
      const editor = createMockEditor({ from: 10, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-ordered", {});

      const call = vi.mocked(respond).mock.calls[0][0] as { data: { block: { inList: string } } };
      expect(call.data.block.inList).toBe("ordered");
    });

    it("detects task list container", async () => {
      const taskItemNode = createMockNode("Todo item", "paragraph");
      const blocks = [taskItemNode];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: taskItemNode,
        depth: 3,
        blockIndex: 0,
        parentNode,
        ancestors: [
          { name: "taskList" },
          { name: "taskItem" },
        ],
      });
      const editor = createMockEditor({ from: 10, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-task", {});

      const call = vi.mocked(respond).mock.calls[0][0] as { data: { block: { inList: string } } };
      expect(call.data.block.inList).toBe("task");
    });
  });

  describe("other container detection", () => {
    it("detects blockquote container", async () => {
      const quotedPara = createMockNode("Quoted text", "paragraph");
      const blocks = [quotedPara];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: quotedPara,
        depth: 2,
        blockIndex: 0,
        parentNode,
        ancestors: [{ name: "blockquote" }],
      });
      const editor = createMockEditor({ from: 10, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-quote", {});

      const call = vi.mocked(respond).mock.calls[0][0] as { data: { block: { inBlockquote: boolean } } };
      expect(call.data.block.inBlockquote).toBe(true);
    });

    it("detects table container", async () => {
      const cellNode = createMockNode("Cell content", "paragraph");
      const blocks = [cellNode];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: cellNode,
        depth: 4, // doc > table > tableRow > tableCell > paragraph
        blockIndex: 0,
        parentNode,
        ancestors: [
          { name: "table" },
          { name: "tableRow" },
          { name: "tableCell" },
        ],
      });
      const editor = createMockEditor({ from: 10, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-table", {});

      const call = vi.mocked(respond).mock.calls[0][0] as { data: { block: { inTable: boolean } } };
      expect(call.data.block.inTable).toBe(true);
    });
  });

  describe("nested container detection", () => {
    it("detects multiple containers (list inside blockquote)", async () => {
      const listItemNode = createMockNode("Quoted list item", "paragraph");
      const blocks = [listItemNode];
      const parentNode = createMockParentNode(blocks);
      const $pos = createMock$Pos({
        parent: listItemNode,
        depth: 4, // doc > blockquote > bulletList > listItem > paragraph
        blockIndex: 0,
        parentNode,
        ancestors: [
          { name: "blockquote" },
          { name: "bulletList" },
          { name: "listItem" },
        ],
      });
      const editor = createMockEditor({ from: 10, $pos, doc: parentNode });

      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleCursorGetContext("req-nested", {});

      const call = vi.mocked(respond).mock.calls[0][0] as { data: { block: { inList: string; inBlockquote: boolean } } };
      expect(call.data.block.inList).toBe("bullet");
      expect(call.data.block.inBlockquote).toBe(true);
    });
  });
});
