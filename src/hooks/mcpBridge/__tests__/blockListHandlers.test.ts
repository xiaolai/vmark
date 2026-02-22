/**
 * Tests for blockListHandlers — block.setType, list.toggle,
 * block.insertHorizontalRule, list.increaseIndent, list.decreaseIndent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
}));

// Mock task list conversion
const mockConvertSelectionToTaskList = vi.fn();
vi.mock("@/plugins/taskToggle/tiptapTaskListUtils", () => ({
  convertSelectionToTaskList: (...args: unknown[]) =>
    mockConvertSelectionToTaskList(...args),
}));

import {
  handleBlockSetType,
  handleListToggle,
  handleInsertHorizontalRule,
  handleListIncreaseIndent,
  handleListDecreaseIndent,
} from "../blockListHandlers";

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
    it("sets block to paragraph", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleBlockSetType("req-1", { blockType: "paragraph" });

      expect(editor.commands.setParagraph).toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: null,
      });
    });

    it("sets block to heading with level", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleBlockSetType("req-2", { blockType: "heading", level: 2 });

      expect(editor.commands.setHeading).toHaveBeenCalledWith({ level: 2 });
    });

    it("returns error for heading without valid level", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleBlockSetType("req-3", { blockType: "heading" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-3",
        success: false,
        error: "level must be between 1 and 6 for heading",
      });
    });

    it("returns error for heading with level out of range", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleBlockSetType("req-3b", { blockType: "heading", level: 7 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-3b",
        success: false,
        error: "level must be between 1 and 6 for heading",
      });
    });

    it("sets codeBlock with language", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleBlockSetType("req-4", {
        blockType: "codeBlock",
        language: "typescript",
      });

      expect(editor.commands.setCodeBlock).toHaveBeenCalledWith({
        language: "typescript",
      });
    });

    it("sets codeBlock without language", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleBlockSetType("req-4b", { blockType: "codeBlock" });

      expect(editor.commands.setCodeBlock).toHaveBeenCalledWith(undefined);
    });

    it("returns error for unknown block type", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleBlockSetType("req-5", { blockType: "unknown" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: "Unknown block type: unknown",
      });
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleBlockSetType("req-6", { blockType: "paragraph" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-6",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleListToggle", () => {
    it("toggles bullet list", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListToggle("req-7", { listType: "bullet" });

      expect(editor.commands.toggleBulletList).toHaveBeenCalled();
    });

    it("toggles ordered list", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListToggle("req-8", { listType: "ordered" });

      expect(editor.commands.toggleOrderedList).toHaveBeenCalled();
    });

    it("converts to task list", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListToggle("req-9", { listType: "task" });

      expect(mockConvertSelectionToTaskList).toHaveBeenCalledWith(editor);
    });

    it("returns error for unknown list type", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListToggle("req-10", { listType: "unknown" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-10",
        success: false,
        error: "Unknown list type: unknown",
      });
    });
  });

  describe("handleInsertHorizontalRule", () => {
    it("inserts horizontal rule", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleInsertHorizontalRule("req-11");

      expect(editor.commands.setHorizontalRule).toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-11",
        success: true,
        data: null,
      });
    });
  });

  describe("handleListIncreaseIndent", () => {
    it("sinks list item", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListIncreaseIndent("req-12");

      expect(editor.commands.sinkListItem).toHaveBeenCalledWith("listItem");
    });
  });

  describe("handleListDecreaseIndent", () => {
    it("lifts list item", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleListDecreaseIndent("req-13");

      expect(editor.commands.liftListItem).toHaveBeenCalledWith("listItem");
    });
  });
});
