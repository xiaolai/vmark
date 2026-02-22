/**
 * MCP Bridge — Editor Handler Tests
 *
 * Tests for editor.undo, editor.redo, editor.focus, editor.getUndoState,
 * and editor.setMode handlers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleUndo,
  handleRedo,
  handleFocus,
  handleSetMode,
} from "./editorHandlers";

vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
}));

vi.mock("@/hooks/useUnifiedHistory", () => ({
  performUnifiedUndo: vi.fn(() => true),
  performUnifiedRedo: vi.fn(() => true),
  canNativeUndo: vi.fn(() => true),
  canNativeRedo: vi.fn(() => false),
}));

vi.mock("@/stores/unifiedHistoryStore", () => ({
  useUnifiedHistoryStore: {
    getState: vi.fn(() => ({
      canUndoCheckpoint: vi.fn(() => false),
      canRedoCheckpoint: vi.fn(() => false),
    })),
  },
}));

vi.mock("@/stores/editorStore", () => ({
  useEditorStore: {
    getState: vi.fn(() => ({
      sourceMode: false,
      setSourceMode: vi.fn(),
    })),
  },
}));

vi.mock("@/stores/activeEditorStore", () => ({
  useActiveEditorStore: {
    getState: vi.fn(() => ({
      activeSourceView: null,
    })),
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(() => ({
      activeTabId: { main: "tab-1" },
    })),
  },
}));

vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@tiptap/pm/history", () => ({
  undoDepth: vi.fn(() => 3),
  redoDepth: vi.fn(() => 1),
}));

vi.mock("@codemirror/commands", () => ({
  undoDepth: vi.fn(() => 0),
  redoDepth: vi.fn(() => 0),
}));

import { respond, getEditor } from "./utils";
import { performUnifiedUndo, performUnifiedRedo } from "@/hooks/useUnifiedHistory";
import { useEditorStore } from "@/stores/editorStore";

describe("editorHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleUndo", () => {
    it("performs undo and returns result", async () => {
      vi.mocked(performUnifiedUndo).mockReturnValue(true);

      await handleUndo("req-1");

      expect(performUnifiedUndo).toHaveBeenCalledWith("main");
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { performed: true },
      });
    });

    it("returns performed=false when nothing to undo", async () => {
      vi.mocked(performUnifiedUndo).mockReturnValue(false);

      await handleUndo("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { performed: false },
      });
    });

    it("returns error on exception", async () => {
      vi.mocked(performUnifiedUndo).mockImplementation(() => {
        throw new Error("Undo failed");
      });

      await handleUndo("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Undo failed",
      });
    });
  });

  describe("handleRedo", () => {
    it("performs redo and returns result", async () => {
      vi.mocked(performUnifiedRedo).mockReturnValue(true);

      await handleRedo("req-1");

      expect(performUnifiedRedo).toHaveBeenCalledWith("main");
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { performed: true },
      });
    });
  });

  describe("handleFocus", () => {
    it("focuses editor", async () => {
      const editor = { commands: { focus: vi.fn() } };
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleFocus("req-1");

      expect(editor.commands.focus).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: null,
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleFocus("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleSetMode", () => {
    it("switches to source mode", async () => {
      const setSourceMode = vi.fn();
      vi.mocked(useEditorStore.getState).mockReturnValue({
        sourceMode: false,
        setSourceMode,
      } as never);

      await handleSetMode("req-1", { mode: "source" });

      expect(setSourceMode).toHaveBeenCalledWith(true);
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { mode: "source", changed: true },
      });
    });

    it("switches to wysiwyg mode", async () => {
      const setSourceMode = vi.fn();
      vi.mocked(useEditorStore.getState).mockReturnValue({
        sourceMode: true,
        setSourceMode,
      } as never);

      await handleSetMode("req-1", { mode: "wysiwyg" });

      expect(setSourceMode).toHaveBeenCalledWith(false);
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { mode: "wysiwyg", changed: true },
      });
    });

    it("returns changed=false when already in target mode", async () => {
      vi.mocked(useEditorStore.getState).mockReturnValue({
        sourceMode: false,
        setSourceMode: vi.fn(),
      } as never);

      await handleSetMode("req-1", { mode: "wysiwyg" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { mode: "wysiwyg", changed: false },
      });
    });

    it("returns error for invalid mode", async () => {
      await handleSetMode("req-1", { mode: "invalid" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: 'Invalid mode: "invalid". Must be "wysiwyg" or "source".',
      });
    });
  });
});
