/**
 * Tests for editorHandlers — editor.undo, editor.redo, editor.focus,
 * editor.getUndoState, editor.setMode.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
}));

// Mock unified history
const mockPerformUnifiedUndo = vi.fn();
const mockPerformUnifiedRedo = vi.fn();
const mockCanNativeUndo = vi.fn();
const mockCanNativeRedo = vi.fn();
vi.mock("@/hooks/useUnifiedHistory", () => ({
  performUnifiedUndo: (...args: unknown[]) => mockPerformUnifiedUndo(...args),
  performUnifiedRedo: (...args: unknown[]) => mockPerformUnifiedRedo(...args),
  canNativeUndo: () => mockCanNativeUndo(),
  canNativeRedo: () => mockCanNativeRedo(),
}));

// Mock ProseMirror history
vi.mock("@tiptap/pm/history", () => ({
  undoDepth: () => 3,
  redoDepth: () => 1,
}));

// Mock CodeMirror commands
vi.mock("@codemirror/commands", () => ({
  undoDepth: () => 0,
  redoDepth: () => 0,
}));

// Mock stores
const mockEditorState = { sourceMode: false, setSourceMode: vi.fn() };
vi.mock("@/stores/editorStore", () => ({
  useEditorStore: {
    getState: () => mockEditorState,
  },
}));

vi.mock("@/stores/activeEditorStore", () => ({
  useActiveEditorStore: {
    getState: () => ({ activeSourceView: null }),
  },
}));

const mockTabStore = { activeTabId: { main: "tab-1" } };
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => mockTabStore,
  },
}));

vi.mock("@/stores/unifiedHistoryStore", () => ({
  useUnifiedHistoryStore: {
    getState: () => ({
      canUndoCheckpoint: () => false,
      canRedoCheckpoint: () => false,
    }),
  },
}));

vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import {
  handleUndo,
  handleRedo,
  handleFocus,
  handleGetUndoState,
  handleSetMode,
} from "../editorHandlers";

describe("editorHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEditorState.sourceMode = false;
  });

  describe("handleUndo", () => {
    it("calls performUnifiedUndo and returns result", async () => {
      mockPerformUnifiedUndo.mockReturnValue(true);

      await handleUndo("req-1");

      expect(mockPerformUnifiedUndo).toHaveBeenCalledWith("main");
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { performed: true },
      });
    });

    it("returns performed=false when nothing to undo", async () => {
      mockPerformUnifiedUndo.mockReturnValue(false);

      await handleUndo("req-2");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-2",
        success: true,
        data: { performed: false },
      });
    });
  });

  describe("handleRedo", () => {
    it("calls performUnifiedRedo and returns result", async () => {
      mockPerformUnifiedRedo.mockReturnValue(true);

      await handleRedo("req-3");

      expect(mockPerformUnifiedRedo).toHaveBeenCalledWith("main");
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-3",
        success: true,
        data: { performed: true },
      });
    });
  });

  describe("handleFocus", () => {
    it("calls editor.commands.focus", async () => {
      const focus = vi.fn();
      mockGetEditor.mockReturnValue({ commands: { focus } });

      await handleFocus("req-4");

      expect(focus).toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-4",
        success: true,
        data: null,
      });
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleFocus("req-5");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleGetUndoState", () => {
    it("returns undo/redo state in WYSIWYG mode", async () => {
      mockCanNativeUndo.mockReturnValue(true);
      mockCanNativeRedo.mockReturnValue(false);
      mockGetEditor.mockReturnValue({ state: {} });

      await handleGetUndoState("req-6");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.canUndo).toBe(true);
      expect(call.data.canRedo).toBe(false);
      expect(call.data.undoDepth).toBe(3);
      expect(call.data.redoDepth).toBe(1);
    });
  });

  describe("handleSetMode", () => {
    it("switches to source mode", async () => {
      mockEditorState.sourceMode = false;

      await handleSetMode("req-7", { mode: "source" });

      expect(mockEditorState.setSourceMode).toHaveBeenCalledWith(true);
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-7",
        success: true,
        data: { mode: "source", changed: true },
      });
    });

    it("does not switch when already in target mode", async () => {
      mockEditorState.sourceMode = true;

      await handleSetMode("req-8", { mode: "source" });

      expect(mockEditorState.setSourceMode).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-8",
        success: true,
        data: { mode: "source", changed: false },
      });
    });

    it("returns error for invalid mode", async () => {
      await handleSetMode("req-9", { mode: "invalid" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-9",
        success: false,
        error: expect.stringContaining("Invalid mode"),
      });
    });
  });
});
