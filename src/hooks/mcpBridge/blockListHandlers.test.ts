/**
 * MCP Bridge — Block List Handler Tests
 *
 * Tests for block.setType, list.toggle, block.insertHorizontalRule,
 * list.increaseIndent, and list.decreaseIndent handlers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleBlockSetType,
  handleListToggle,
  handleInsertHorizontalRule,
  handleListIncreaseIndent,
  handleListDecreaseIndent,
} from "./blockListHandlers";

vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
}));

vi.mock("@/plugins/taskToggle/tiptapTaskListUtils", () => ({
  convertSelectionToTaskList: vi.fn(),
}));

import { respond, getEditor } from "./utils";
import { convertSelectionToTaskList } from "@/plugins/taskToggle/tiptapTaskListUtils";

function createMockEditor() {
  return {
    commands: {
      setParagraph: vi.fn(),
      setHeading: vi.fn(),
      setCodeBlock: vi.fn(),
      setBlockquote: vi.fn(),
      toggleBulletList: vi.fn(),
      toggleOrderedList: vi.fn(),
      setHorizontalRule: vi.fn(),
      sinkListItem: vi.fn(),
      liftListItem: vi.fn(),
    },
  };
}

describe("blockListHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleBlockSetType", () => {
    it("sets paragraph type", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleBlockSetType("req-1", { blockType: "paragraph" });

      expect(editor.commands.setParagraph).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("sets heading type with level", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleBlockSetType("req-1", { blockType: "heading", level: 2 });

      expect(editor.commands.setHeading).toHaveBeenCalledWith({ level: 2 });
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("returns error for heading without valid level", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleBlockSetType("req-1", { blockType: "heading" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "level must be between 1 and 6 for heading",
      });
    });

    it("returns error for heading with level > 6", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleBlockSetType("req-1", { blockType: "heading", level: 7 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "level must be between 1 and 6 for heading",
      });
    });

    it("sets codeBlock type with language", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleBlockSetType("req-1", { blockType: "codeBlock", language: "javascript" });

      expect(editor.commands.setCodeBlock).toHaveBeenCalledWith({ language: "javascript" });
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("sets codeBlock type without language", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleBlockSetType("req-1", { blockType: "codeBlock" });

      expect(editor.commands.setCodeBlock).toHaveBeenCalledWith(undefined);
    });

    it("sets blockquote type", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleBlockSetType("req-1", { blockType: "blockquote" });

      expect(editor.commands.setBlockquote).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("returns error for unknown block type", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleBlockSetType("req-1", { blockType: "unknown" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Unknown block type: unknown",
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleBlockSetType("req-1", { blockType: "paragraph" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleListToggle", () => {
    it("toggles bullet list", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleListToggle("req-1", { listType: "bullet" });

      expect(editor.commands.toggleBulletList).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("toggles ordered list", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleListToggle("req-1", { listType: "ordered" });

      expect(editor.commands.toggleOrderedList).toHaveBeenCalled();
    });

    it("converts to task list", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleListToggle("req-1", { listType: "task" });

      expect(convertSelectionToTaskList).toHaveBeenCalledWith(editor);
    });

    it("returns error for unknown list type", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleListToggle("req-1", { listType: "unknown" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Unknown list type: unknown",
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleListToggle("req-1", { listType: "bullet" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleInsertHorizontalRule", () => {
    it("inserts horizontal rule", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertHorizontalRule("req-1");

      expect(editor.commands.setHorizontalRule).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleInsertHorizontalRule("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleListIncreaseIndent", () => {
    it("sinks list item", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleListIncreaseIndent("req-1");

      expect(editor.commands.sinkListItem).toHaveBeenCalledWith("listItem");
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);
      await handleListIncreaseIndent("req-1");
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleListDecreaseIndent", () => {
    it("lifts list item", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleListDecreaseIndent("req-1");

      expect(editor.commands.liftListItem).toHaveBeenCalledWith("listItem");
      expect(respond).toHaveBeenCalledWith({ id: "req-1", success: true, data: null });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);
      await handleListDecreaseIndent("req-1");
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });
});
