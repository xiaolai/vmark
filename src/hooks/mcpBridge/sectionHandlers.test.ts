/**
 * MCP Bridge — Section Handler Tests
 *
 * Tests for section.update, section.insert, and section.move handlers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleSectionUpdate, handleSectionInsert, handleSectionMove } from "./sectionHandlers";

vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
  isAutoApproveEnabled: vi.fn(() => true),
  getActiveTabId: vi.fn(() => "test-tab"),
}));

vi.mock("./revisionTracker", () => ({
  validateBaseRevision: vi.fn(() => null),
  getCurrentRevision: vi.fn(() => "rev-new"),
}));

vi.mock("@/stores/aiSuggestionStore", () => ({
  useAiSuggestionStore: {
    getState: vi.fn(() => ({
      addSuggestion: vi.fn(() => "sug-1"),
    })),
  },
}));

vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  createMarkdownPasteSlice: vi.fn(() => ({ content: { size: 5 } })),
}));

vi.mock("@/utils/markdownPipeline", () => ({
  serializeMarkdown: vi.fn(() => "# Section\n\nContent"),
}));

import { respond, getEditor, isAutoApproveEnabled } from "./utils";
import { validateBaseRevision } from "./revisionTracker";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";

// Helper: build a mock node
function mockNode(type: string, text: string, attrs: Record<string, unknown> = {}, nodeSize = text.length + 10) {
  return {
    type: { name: type }, attrs, nodeSize, textContent: text,
    descendants: vi.fn((cb: (child: Record<string, unknown>) => boolean) => {
      if (text) cb({ isText: true, text });
    }),
  };
}

type NodeInfo = ReturnType<typeof mockNode>;

/** Create a mock editor. Pass `includeHeading: true` for a doc with a heading section. */
function createMockEditor(includeHeading: boolean) {
  const headingNode = includeHeading ? mockNode("heading", "My Section", { level: 2 }, 20) : null;
  const paraNode = mockNode("paragraph", includeHeading ? "content" : "just text", {}, 30);
  const allNodes: Array<{ node: NodeInfo; pos: number }> = [];
  if (headingNode) allNodes.push({ node: headingNode, pos: 0 });
  allNodes.push({ node: paraNode, pos: headingNode ? 20 : 0 });
  const docSize = allNodes.reduce((s, n) => s + n.node.nodeSize, 0);

  const mockTr = { replaceRange: vi.fn().mockReturnThis(), replace: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis() };
  const mockChain = { focus: vi.fn().mockReturnThis(), setTextSelection: vi.fn().mockReturnThis(), insertContent: vi.fn().mockReturnThis(), run: vi.fn() };

  return {
    state: {
      doc: {
        descendants: vi.fn((cb: (node: Record<string, unknown>, pos: number) => boolean | void) => {
          for (const { node, pos } of allNodes) cb(node, pos);
        }),
        content: { size: docSize },
        textBetween: vi.fn(() => paraNode.textContent),
        nodesBetween: vi.fn((_f: number, _t: number, cb: (n: Record<string, unknown>, p: number) => boolean | void) => {
          if (headingNode) cb(headingNode, 0);
        }),
        slice: vi.fn(() => ({ content: allNodes.map((n) => n.node) })),
      },
      tr: mockTr,
      schema: { nodes: { doc: { create: vi.fn((_: unknown, c: unknown) => ({ content: c })) } } },
    },
    view: { dispatch: vi.fn() },
    chain: vi.fn(() => mockChain),
  };
}

describe("sectionHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateBaseRevision).mockReturnValue(null);
    vi.mocked(isAutoApproveEnabled).mockReturnValue(true);
  });

  // ---- handleSectionUpdate ----

  describe("handleSectionUpdate", () => {
    it("returns revision conflict error", async () => {
      vi.mocked(validateBaseRevision).mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleSectionUpdate("req-1", {
        baseRevision: "rev-old",
        target: { heading: "My Section" },
        newContent: "updated",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Revision conflict",
        data: { code: "conflict", currentRevision: "rev-current" },
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleSectionUpdate("req-1", {
        baseRevision: "rev-1",
        target: { heading: "My Section" },
        newContent: "updated",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when target missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor(true) as never);

      await handleSectionUpdate("req-1", {
        baseRevision: "rev-1",
        newContent: "updated",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "target is required",
      });
    });

    it("returns not_found when section missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor(false) as never);

      await handleSectionUpdate("req-1", {
        baseRevision: "rev-1",
        target: { heading: "Nonexistent" },
        newContent: "updated",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Section not found",
        data: { code: "not_found" },
      });
    });

    it("returns dryRun preview", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor(true) as never);

      await handleSectionUpdate("req-1", {
        baseRevision: "rev-1",
        target: { heading: "My Section" },
        newContent: "updated content",
        mode: "dryRun",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          isDryRun: true,
          preview: expect.objectContaining({
            sectionHeading: "My Section",
            newContentLength: "updated content".length,
          }),
        }),
      });
    });

    it("creates suggestion in suggest mode", async () => {
      vi.mocked(isAutoApproveEnabled).mockReturnValue(false);
      const addSuggestion = vi.fn(() => "sug-update");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({ addSuggestion } as never);
      vi.mocked(getEditor).mockReturnValue(createMockEditor(true) as never);

      await handleSectionUpdate("req-1", {
        baseRevision: "rev-1",
        target: { heading: "My Section" },
        newContent: "updated",
        mode: "suggest",
      });

      expect(addSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: "test-tab",
          type: "replace",
          newContent: "updated",
        }),
      );
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          suggestionIds: ["sug-update"],
        }),
      });
    });

    it("applies update in apply mode", async () => {
      vi.mocked(isAutoApproveEnabled).mockReturnValue(true);
      const editor = createMockEditor(true);
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleSectionUpdate("req-1", {
        baseRevision: "rev-1",
        target: { heading: "My Section" },
        newContent: "updated",
        mode: "apply",
      });

      expect(editor.view.dispatch).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          newRevision: "rev-new",
          sectionHeading: "My Section",
        }),
      });
    });
  });

  // ---- handleSectionInsert ----

  describe("handleSectionInsert", () => {
    it("returns revision conflict error", async () => {
      vi.mocked(validateBaseRevision).mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleSectionInsert("req-1", {
        baseRevision: "rev-old",
        heading: { level: 2, text: "New" },
        content: "body",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Revision conflict",
        data: { code: "conflict", currentRevision: "rev-current" },
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleSectionInsert("req-1", {
        baseRevision: "rev-1",
        heading: { level: 2, text: "New" },
        content: "body",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when heading missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor(true) as never);

      await handleSectionInsert("req-1", {
        baseRevision: "rev-1",
        heading: { level: 0, text: "" },
        content: "body",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "heading with level and text is required",
      });
    });

    it("returns not_found when after section missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor(false) as never);

      await handleSectionInsert("req-1", {
        baseRevision: "rev-1",
        heading: { level: 2, text: "New" },
        content: "body",
        after: { heading: "Nonexistent" },
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "After section not found",
        data: { code: "not_found" },
      });
    });

    it("returns dryRun preview", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor(true) as never);

      await handleSectionInsert("req-1", {
        baseRevision: "rev-1",
        heading: { level: 2, text: "New" },
        content: "body",
        mode: "dryRun",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          isDryRun: true,
          preview: expect.objectContaining({
            headingLevel: 2,
            headingText: "New",
            contentLength: "body".length,
          }),
        }),
      });
    });

    it("creates suggestion in suggest mode", async () => {
      vi.mocked(isAutoApproveEnabled).mockReturnValue(false);
      const addSuggestion = vi.fn(() => "sug-insert");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({ addSuggestion } as never);
      vi.mocked(getEditor).mockReturnValue(createMockEditor(true) as never);

      await handleSectionInsert("req-1", {
        baseRevision: "rev-1",
        heading: { level: 2, text: "New" },
        content: "body",
        mode: "suggest",
      });

      expect(addSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: "test-tab",
          type: "insert",
          newContent: "## New\n\nbody",
        }),
      );
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          suggestionIds: ["sug-insert"],
        }),
      });
    });

    it("applies insert in apply mode", async () => {
      vi.mocked(isAutoApproveEnabled).mockReturnValue(true);
      const editor = createMockEditor(true);
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleSectionInsert("req-1", {
        baseRevision: "rev-1",
        heading: { level: 3, text: "New" },
        content: "body text",
        mode: "apply",
      });

      expect(editor.chain).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          newRevision: "rev-new",
          headingText: "New",
        }),
      });
    });
  });

  // ---- handleSectionMove ----

  describe("handleSectionMove", () => {
    it("returns revision conflict error", async () => {
      vi.mocked(validateBaseRevision).mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleSectionMove("req-1", {
        baseRevision: "rev-old",
        section: { heading: "My Section" },
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Revision conflict",
        data: { code: "conflict", currentRevision: "rev-current" },
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleSectionMove("req-1", {
        baseRevision: "rev-1",
        section: { heading: "My Section" },
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when section target missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor(true) as never);

      await handleSectionMove("req-1", {
        baseRevision: "rev-1",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "section is required",
      });
    });

    it("returns not_found when source section missing", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor(false) as never);

      await handleSectionMove("req-1", {
        baseRevision: "rev-1",
        section: { heading: "Nonexistent" },
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Section to move not found",
        data: { code: "not_found" },
      });
    });

    it("returns no-op when moving to same position", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor(true) as never);

      await handleSectionMove("req-1", {
        baseRevision: "rev-1",
        section: { heading: "My Section" },
        after: { heading: "My Section" },
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          warning: "Source and target are the same section — no move needed",
          movedSection: "My Section",
        }),
      });
    });

    it("returns dryRun preview", async () => {
      vi.mocked(getEditor).mockReturnValue(createMockEditor(true) as never);

      await handleSectionMove("req-1", {
        baseRevision: "rev-1",
        section: { heading: "My Section" },
        mode: "dryRun",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          isDryRun: true,
          preview: expect.objectContaining({
            sectionHeading: "My Section",
            fromRange: { from: 0, to: 50 },
            targetPosition: 0,
          }),
        }),
      });
    });

    it("creates delete+insert suggestions in suggest mode", async () => {
      vi.mocked(isAutoApproveEnabled).mockReturnValue(false);
      const addSuggestion = vi.fn()
        .mockReturnValueOnce("sug-delete")
        .mockReturnValueOnce("sug-insert");
      vi.mocked(useAiSuggestionStore.getState).mockReturnValue({ addSuggestion } as never);
      vi.mocked(getEditor).mockReturnValue(createMockEditor(true) as never);

      await handleSectionMove("req-1", {
        baseRevision: "rev-1",
        section: { heading: "My Section" },
        mode: "suggest",
      });

      expect(addSuggestion).toHaveBeenCalledTimes(2);
      expect(addSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({ type: "delete", from: 0, to: 50 }),
      );
      expect(addSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({ type: "insert", from: 0, to: 0 }),
      );
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          suggestionIds: ["sug-delete", "sug-insert"],
          warning: expect.stringContaining("delete+insert"),
        }),
      });
    });

    it("applies move in apply mode", async () => {
      vi.mocked(isAutoApproveEnabled).mockReturnValue(true);
      const editor = createMockEditor(true);
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleSectionMove("req-1", {
        baseRevision: "rev-1",
        section: { heading: "My Section" },
        mode: "apply",
      });

      expect(editor.view.dispatch).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          success: true,
          newRevision: "rev-new",
          movedSection: "My Section",
        }),
      });
    });
  });
});