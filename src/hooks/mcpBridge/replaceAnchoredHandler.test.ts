/**
 * MCP Bridge — Replace Anchored Handler Tests
 *
 * Tests for replace_text_anchored handler: context similarity scoring,
 * revision validation, mode branches, and edge cases (not found, ambiguous).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleReplaceAnchored } from "./replaceAnchoredHandler";

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
      doc: { textContent: "some text here" },
      tr: mockTr,
    },
    view: { dispatch: vi.fn() },
    mockTr,
  };
}

describe("replaceAnchoredHandler", () => {
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

      await handleReplaceAnchored("req-1", { baseRevision: "rev-old" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Revision conflict",
        data: { code: "conflict", currentRevision: "rev-current" },
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleReplaceAnchored("req-1", {
        baseRevision: "rev-1",
        anchor: { text: "hello" },
        replacement: "hi",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when anchor is missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleReplaceAnchored("req-1", {
        baseRevision: "rev-1",
        replacement: "hi",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "anchor.text is required",
      });
    });

    it("returns error when anchor.text is missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);

      await handleReplaceAnchored("req-1", {
        baseRevision: "rev-1",
        anchor: { beforeContext: "ctx", afterContext: "ctx" },
        replacement: "hi",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "anchor.text is required",
      });
    });
  });

  describe("no matching candidates", () => {
    it("returns not_found when no matches at all", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);
      vi.mocked(findTextMatches).mockReturnValue([]);

      await handleReplaceAnchored("req-1", {
        baseRevision: "rev-1",
        anchor: { text: "hello", beforeContext: "ctx", afterContext: "ctx" },
        replacement: "hi",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: false,
          matchCount: 0,
          error: "not_found",
        }),
      });
    });

    it("returns not_found when matches exist but similarity too low", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);
      // Return a match whose context is completely different
      vi.mocked(findTextMatches).mockReturnValue([
        {
          from: 0,
          to: 5,
          nodeId: "p-0",
          context: { before: "zzzzzzzzz", after: "xxxxxxxxx" },
        },
      ] as never);

      await handleReplaceAnchored("req-1", {
        baseRevision: "rev-1",
        anchor: {
          text: "hello",
          beforeContext: "abcdefghij",
          afterContext: "abcdefghij",
        },
        replacement: "hi",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: false,
          error: "not_found",
        }),
      });
    });
  });

  describe("ambiguous candidates", () => {
    it("returns ambiguous_target when multiple candidates pass threshold", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);
      // Return two matches with identical good context
      vi.mocked(findTextMatches).mockReturnValue([
        { from: 0, to: 5, nodeId: "p-0", context: { before: "same ctx", after: "same ctx" } },
        { from: 10, to: 15, nodeId: "p-1", context: { before: "same ctx", after: "same ctx" } },
      ] as never);

      await handleReplaceAnchored("req-1", {
        baseRevision: "rev-1",
        anchor: {
          text: "hello",
          beforeContext: "same ctx",
          afterContext: "same ctx",
        },
        replacement: "hi",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: false,
          matchCount: 2,
          error: "ambiguous_target",
        }),
      });
    });
  });

  describe("dryRun mode", () => {
    it("returns preview without applying", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);
      vi.mocked(findTextMatches).mockReturnValue([
        { from: 0, to: 5, nodeId: "p-0", context: { before: "match ctx", after: "match ctx" } },
      ] as never);

      await handleReplaceAnchored("req-1", {
        baseRevision: "rev-1",
        anchor: {
          text: "hello",
          beforeContext: "match ctx",
          afterContext: "match ctx",
        },
        replacement: "hi",
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
  });

  describe("suggest mode", () => {
    it("creates suggestion for single matching candidate", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor() as never);
      vi.mocked(findTextMatches).mockReturnValue([
        { from: 0, to: 5, nodeId: "p-0", context: { before: "match ctx", after: "match ctx" } },
      ] as never);

      const addSuggestion = vi.fn(() => "sug-anchored");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({
        addSuggestion,
      } as never);

      await handleReplaceAnchored("req-1", {
        baseRevision: "rev-1",
        anchor: {
          text: "hello",
          beforeContext: "match ctx",
          afterContext: "match ctx",
        },
        replacement: "hi",
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
          suggestionIds: ["sug-anchored"],
        }),
      });
    });
  });

  describe("apply mode", () => {
    it("applies replacement directly", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);
      vi.mocked(isAutoApproveEnabled).mockReturnValue(true);
      vi.mocked(findTextMatches).mockReturnValue([
        { from: 0, to: 5, nodeId: "p-0", context: { before: "match ctx", after: "match ctx" } },
      ] as never);

      await handleReplaceAnchored("req-1", {
        baseRevision: "rev-1",
        anchor: {
          text: "hello",
          beforeContext: "match ctx",
          afterContext: "match ctx",
        },
        replacement: "hi",
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
  });

  describe("respond always called", () => {
    it("calls respond on unexpected throw", async () => {
      vi.mocked(getEditor).mockImplementation(() => {
        throw new Error("Unexpected failure");
      });

      await handleReplaceAnchored("req-1", {
        baseRevision: "rev-1",
        anchor: { text: "hello", beforeContext: "", afterContext: "" },
        replacement: "hi",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Unexpected failure",
      });
    });
  });
});
