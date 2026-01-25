/**
 * MCP Bridge - Format Handler Tests
 *
 * Tests for format.toggle, format.setLink, format.removeLink, and format.clear handlers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleFormatToggle,
  handleFormatSetLink,
  handleFormatRemoveLink,
  handleFormatClear,
} from "./formatHandlers";

// Mock the utils module
vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
}));

import { respond, getEditor } from "./utils";

/**
 * Create a mock editor with format commands.
 */
function createMockEditor() {
  return {
    commands: {
      toggleBold: vi.fn(),
      toggleItalic: vi.fn(),
      toggleCode: vi.fn(),
      toggleStrike: vi.fn(),
      toggleMark: vi.fn(),
      setLink: vi.fn(),
      unsetLink: vi.fn(),
      unsetAllMarks: vi.fn(),
    },
  };
}

describe("formatHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleFormatToggle", () => {
    it("toggles bold format", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFormatToggle("req-1", { format: "bold" });

      expect(editor.commands.toggleBold).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: null,
      });
    });

    it("toggles italic format", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFormatToggle("req-2", { format: "italic" });

      expect(editor.commands.toggleItalic).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-2",
        success: true,
        data: null,
      });
    });

    it("toggles code format", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFormatToggle("req-3", { format: "code" });

      expect(editor.commands.toggleCode).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-3",
        success: true,
        data: null,
      });
    });

    it("toggles strike format", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFormatToggle("req-4", { format: "strike" });

      expect(editor.commands.toggleStrike).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-4",
        success: true,
        data: null,
      });
    });

    it("toggles underline format via toggleMark", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFormatToggle("req-5", { format: "underline" });

      expect(editor.commands.toggleMark).toHaveBeenCalledWith("underline");
      expect(respond).toHaveBeenCalledWith({
        id: "req-5",
        success: true,
        data: null,
      });
    });

    it("toggles highlight format via toggleMark", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFormatToggle("req-6", { format: "highlight" });

      expect(editor.commands.toggleMark).toHaveBeenCalledWith("highlight");
      expect(respond).toHaveBeenCalledWith({
        id: "req-6",
        success: true,
        data: null,
      });
    });

    it("accepts mark parameter as alias for format", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFormatToggle("req-7", { mark: "bold" });

      expect(editor.commands.toggleBold).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-7",
        success: true,
        data: null,
      });
    });

    it("returns error for unknown format", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFormatToggle("req-8", { format: "unknown" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-8",
        success: false,
        error: "Unknown format: unknown",
      });
    });

    it("returns error when no editor is available", async () => {
      vi.mocked(getEditor).mockReturnValue(null);

      await handleFormatToggle("req-9", { format: "bold" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-9",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleFormatSetLink", () => {
    it("sets link with href", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFormatSetLink("req-10", { href: "https://example.com" });

      expect(editor.commands.setLink).toHaveBeenCalledWith({ href: "https://example.com" });
      expect(respond).toHaveBeenCalledWith({
        id: "req-10",
        success: true,
        data: null,
      });
    });

    it("returns error when href is not a string", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFormatSetLink("req-11", { href: 123 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-11",
        success: false,
        error: "href must be a string",
      });
    });

    it("returns error when href is missing", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFormatSetLink("req-12", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-12",
        success: false,
        error: "href must be a string",
      });
    });

    it("returns error when no editor is available", async () => {
      vi.mocked(getEditor).mockReturnValue(null);

      await handleFormatSetLink("req-13", { href: "https://example.com" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-13",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleFormatRemoveLink", () => {
    it("removes link with unsetLink", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFormatRemoveLink("req-20");

      expect(editor.commands.unsetLink).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-20",
        success: true,
        data: null,
      });
    });

    it("returns error when no editor is available", async () => {
      vi.mocked(getEditor).mockReturnValue(null);

      await handleFormatRemoveLink("req-21");

      expect(respond).toHaveBeenCalledWith({
        id: "req-21",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleFormatClear", () => {
    it("clears all marks with unsetAllMarks", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFormatClear("req-30");

      expect(editor.commands.unsetAllMarks).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-30",
        success: true,
        data: null,
      });
    });

    it("returns error when no editor is available", async () => {
      vi.mocked(getEditor).mockReturnValue(null);

      await handleFormatClear("req-31");

      expect(respond).toHaveBeenCalledWith({
        id: "req-31",
        success: false,
        error: "No active editor",
      });
    });
  });
});
