/**
 * MCP Bridge — Apply Diff Handler Tests
 *
 * Tests for apply_diff handler: match policies (first/all/nth/error_if_multiple),
 * revision validation, mode branches (apply/suggest/dryRun), and edge cases.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleApplyDiff } from "./applyDiffHandler";

// Mock utils
vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
  isAutoApproveEnabled: vi.fn(() => false),
  getActiveTabId: vi.fn(() => "test-tab"),
  findTextMatches: vi.fn(() => []),
}));

// Mock revisionTracker
vi.mock("./revisionTracker", () => ({
  validateBaseRevision: vi.fn(() => null),
  getCurrentRevision: vi.fn(() => "rev-new"),
}));

// Mock aiSuggestionStore
vi.mock("@/stores/aiSuggestionStore", () => ({
  useAiSuggestionStore: {
    getState: vi.fn(() => ({
      addSuggestion: vi.fn(() => "suggestion-1"),
    })),
  },
}));

// Mock markdownPaste
vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  createMarkdownPasteSlice: vi.fn(() => ({ content: { size: 5 } })),
}));

import { respond, getEditor, isAutoApproveEnabled, findTextMatches } from "./utils";
import { validateBaseRevision } from "./revisionTracker";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";

function createMockEditor() {
  const mockTr = {
    replaceRange: vi.fn().mockReturnThis(),
  };
  return {
    state: {
      doc: { textContent: "hello world hello" },
      tr: mockTr,
    },
    view: { dispatch: vi.fn() },
    mockTr,
  };
}

describe("applyDiffHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateBaseRevision).mockReturnValue(null);
    vi.mocked(isAutoApproveEnabled).mockReturnValue(false);
  });

  describe("validation", () => {
    it("returns revision conflict error", async () => {
      vi.mocked(validateBaseRevision).mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleApplyDiff("req-1", { baseRevision: "rev-old" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Revision conflict",
        data: { code: "conflict", currentRevision: "rev-current" },
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleApplyDiff("req-1", { baseRevision: "rev-1", original: "x", replacement: "y" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when original is missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleApplyDiff("req-1", { baseRevision: "rev-1", replacement: "y" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "original is required",
      });
    });

    it("returns error when replacement is undefined", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleApplyDiff("req-1", { baseRevision: "rev-1", original: "x" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "replacement is required",
      });
    });

    it("returns error when nth policy but nth is missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleApplyDiff("req-1", {
        baseRevision: "rev-1",
        original: "hello",
        replacement: "hi",
        matchPolicy: "nth",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "invalid_operation",
        data: { code: "invalid_operation", message: "nth is required when matchPolicy is 'nth'" },
      });
    });

    it("returns error when nth is negative", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleApplyDiff("req-1", {
        baseRevision: "rev-1",
        original: "hello",
        replacement: "hi",
        matchPolicy: "nth",
        nth: -1,
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "invalid_operation",
        data: { code: "invalid_operation", message: "nth must be a non-negative integer" },
      });
    });

    it("returns error when nth is out of range", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);
      vi.mocked(findTextMatches).mockReturnValue([
        { from: 0, to: 5, nodeId: "p-0", context: { before: "", after: " world" } },
      ] as never);

      await handleApplyDiff("req-1", {
        baseRevision: "rev-1",
        original: "hello",
        replacement: "hi",
        matchPolicy: "nth",
        nth: 5,
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "invalid_operation",
        data: {
          code: "invalid_operation",
          message: "nth (5) is out of range. Only 1 match(es) found.",
        },
      });
    });
  });

  describe("no matches", () => {
    it("returns success with zero counts when no matches found", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);
      vi.mocked(findTextMatches).mockReturnValue([]);

      await handleApplyDiff("req-1", {
        baseRevision: "rev-1",
        original: "nonexistent",
        replacement: "new",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { success: true, matchCount: 0, appliedCount: 0 },
      });
    });
  });

  describe("error_if_multiple policy", () => {
    it("returns ambiguous_target when multiple matches", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);
      vi.mocked(findTextMatches).mockReturnValue([
        { from: 0, to: 5, nodeId: "p-0", context: { before: "", after: " world" } },
        { from: 12, to: 17, nodeId: "p-0", context: { before: "world ", after: "" } },
      ] as never);

      await handleApplyDiff("req-1", {
        baseRevision: "rev-1",
        original: "hello",
        replacement: "hi",
        matchPolicy: "error_if_multiple",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: false,
          matchCount: 2,
          appliedCount: 0,
          error: "ambiguous_target",
        }),
      });
    });
  });

  describe("dryRun mode", () => {
    it("returns preview without applying", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);
      vi.mocked(findTextMatches).mockReturnValue([
        { from: 0, to: 5, nodeId: "p-0", context: { before: "", after: " world" } },
      ] as never);

      await handleApplyDiff("req-1", {
        baseRevision: "rev-1",
        original: "hello",
        replacement: "hi",
        matchPolicy: "first",
        mode: "dryRun",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          matchCount: 1,
          appliedCount: 1,
          isDryRun: true,
        }),
      });
    });

    it("reports all matches for policy all in dryRun", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);
      vi.mocked(findTextMatches).mockReturnValue([
        { from: 0, to: 5, nodeId: "p-0", context: { before: "", after: " world" } },
        { from: 12, to: 17, nodeId: "p-0", context: { before: "world ", after: "" } },
      ] as never);

      await handleApplyDiff("req-1", {
        baseRevision: "rev-1",
        original: "hello",
        replacement: "hi",
        matchPolicy: "all",
        mode: "dryRun",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          appliedCount: 2,
          isDryRun: true,
        }),
      });
    });
  });

  describe("suggest mode", () => {
    it("creates suggestion for first match", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);
      vi.mocked(findTextMatches).mockReturnValue([
        { from: 0, to: 5, nodeId: "p-0", context: { before: "", after: " world" } },
      ] as never);

      const addSuggestion = vi.fn(() => "sug-123");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({
        addSuggestion,
      } as never);

      await handleApplyDiff("req-1", {
        baseRevision: "rev-1",
        original: "hello",
        replacement: "hi",
        matchPolicy: "first",
        mode: "suggest",
      });

      expect(addSuggestion).toHaveBeenCalledWith({
        tabId: "test-tab",
        type: "replace",
        from: 0,
        to: 5,
        newContent: "hi",
        originalContent: "hello",
      });
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          suggestionIds: ["sug-123"],
        }),
      });
    });

    it("creates suggestion for nth match", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);
      vi.mocked(findTextMatches).mockReturnValue([
        { from: 0, to: 5, nodeId: "p-0", context: { before: "", after: " world" } },
        { from: 12, to: 17, nodeId: "p-0", context: { before: "world ", after: "" } },
      ] as never);

      const addSuggestion = vi.fn(() => "sug-nth");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({
        addSuggestion,
      } as never);

      await handleApplyDiff("req-1", {
        baseRevision: "rev-1",
        original: "hello",
        replacement: "hi",
        matchPolicy: "nth",
        nth: 1,
        mode: "suggest",
      });

      expect(addSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({ from: 12, to: 17 }),
      );
    });
  });

  describe("apply mode", () => {
    it("applies first match directly", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);
      vi.mocked(isAutoApproveEnabled).mockReturnValue(true);
      vi.mocked(findTextMatches).mockReturnValue([
        { from: 0, to: 5, nodeId: "p-0", context: { before: "", after: " world" } },
      ] as never);

      await handleApplyDiff("req-1", {
        baseRevision: "rev-1",
        original: "hello",
        replacement: "hi",
        matchPolicy: "first",
        mode: "apply",
      });

      expect(editor.mockTr.replaceRange).toHaveBeenCalledWith(0, 5, expect.anything());
      expect(editor.view.dispatch).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          appliedCount: 1,
          newRevision: "rev-new",
        }),
      });
    });

    it("applies all matches in reverse order", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);
      vi.mocked(isAutoApproveEnabled).mockReturnValue(true);
      vi.mocked(findTextMatches).mockReturnValue([
        { from: 0, to: 5, nodeId: "p-0", context: { before: "", after: " world" } },
        { from: 12, to: 17, nodeId: "p-0", context: { before: "world ", after: "" } },
      ] as never);

      await handleApplyDiff("req-1", {
        baseRevision: "rev-1",
        original: "hello",
        replacement: "hi",
        matchPolicy: "all",
        mode: "apply",
      });

      // Should dispatch twice (one per match)
      expect(editor.view.dispatch).toHaveBeenCalledTimes(2);
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          appliedCount: 2,
          newRevision: "rev-new",
        }),
      });
    });
  });

  describe("respond always called", () => {
    it("calls respond on unexpected throw", async () => {
      vi.mocked(getEditor).mockImplementation(() => {
        throw new Error("Unexpected boom");
      });

      await handleApplyDiff("req-1", {
        baseRevision: "rev-1",
        original: "x",
        replacement: "y",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Unexpected boom",
      });
    });
  });
});
