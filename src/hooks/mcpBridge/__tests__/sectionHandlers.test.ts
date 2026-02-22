/**
 * Tests for sectionHandlers — section.update, section.insert, section.move.
 *
 * These handlers perform complex section-level operations with heading
 * detection, range selection, and atomic moves. Tests verify argument
 * validation, error handling, and key logical branches.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
const mockIsAutoApproveEnabled = vi.fn().mockReturnValue(true);
const mockGetActiveTabId = vi.fn().mockReturnValue("tab-1");
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
  isAutoApproveEnabled: () => mockIsAutoApproveEnabled(),
  getActiveTabId: () => mockGetActiveTabId(),
}));

// Mock revision tracker
const mockValidateBaseRevision = vi.fn();
const mockGetCurrentRevision = vi.fn().mockReturnValue("rev-new");
vi.mock("../revisionTracker", () => ({
  validateBaseRevision: (...args: unknown[]) =>
    mockValidateBaseRevision(...args),
  getCurrentRevision: () => mockGetCurrentRevision(),
}));

// Mock suggestion store
vi.mock("@/stores/aiSuggestionStore", () => ({
  useAiSuggestionStore: {
    getState: () => ({
      addSuggestion: vi.fn().mockReturnValue("suggestion-1"),
    }),
  },
}));

// Mock markdown paste slice
vi.mock("@/plugins/markdownPaste/tiptap", () => ({
  createMarkdownPasteSlice: vi.fn().mockReturnValue({ content: "mock" }),
}));

// Mock serializer
vi.mock("@/utils/markdownPipeline", () => ({
  serializeMarkdown: vi.fn().mockReturnValue("serialized content"),
}));

import {
  handleSectionUpdate,
  handleSectionInsert,
  handleSectionMove,
} from "../sectionHandlers";

/** Create a mock editor with headings and paragraphs. */
function createMockEditor(
  blocks: Array<{
    type: string;
    level?: number;
    text: string;
    nodeSize: number;
  }>
) {
  let totalSize = 0;
  const nodes = blocks.map((b) => {
    const from = totalSize;
    totalSize += b.nodeSize;
    return {
      type: { name: b.type },
      attrs: { level: b.level ?? 0 },
      nodeSize: b.nodeSize,
      isText: false,
      text: undefined,
      textContent: b.text,
      from,
      descendants: (cb: (child: unknown) => boolean) => {
        cb({ isText: true, text: b.text });
        return true;
      },
    };
  });

  const chainMethods = {
    focus: vi.fn().mockReturnThis(),
    setTextSelection: vi.fn().mockReturnThis(),
    deleteRange: vi.fn().mockReturnThis(),
    deleteSelection: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    insertContentAt: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };

  const schemaObj = {
    nodes: {
      doc: {
        create: vi.fn().mockReturnValue({ content: [] }),
      },
    },
  };

  return {
    state: {
      schema: schemaObj,
      doc: {
        content: { size: totalSize },
        schema: schemaObj,
        descendants: (
          cb: (node: unknown, pos: number) => boolean | undefined
        ) => {
          let pos = 0;
          for (const node of nodes) {
            const result = cb(node, pos);
            if (result === false) break;
            pos += node.nodeSize;
          }
        },
        nodesBetween: (
          from: number,
          to: number,
          cb: (node: unknown, pos: number) => boolean | undefined
        ) => {
          let pos = 0;
          for (const node of nodes) {
            if (pos >= from && pos < to) {
              const result = cb(node, pos);
              if (result === false) break;
            }
            pos += node.nodeSize;
          }
        },
        textBetween: vi.fn().mockReturnValue("section content"),
        slice: vi.fn().mockReturnValue({
          content: { toJSON: () => [] },
        }),
      },
      tr: {
        replaceRange: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      },
    },
    view: {
      dispatch: vi.fn(),
    },
    chain: vi.fn().mockReturnValue(chainMethods),
    _chainMethods: chainMethods,
  };
}

describe("sectionHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateBaseRevision.mockReturnValue(null);
    mockIsAutoApproveEnabled.mockReturnValue(true);
  });

  describe("handleSectionUpdate", () => {
    it("returns revision conflict error", async () => {
      mockValidateBaseRevision.mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleSectionUpdate("req-1", {
        baseRevision: "rev-old",
        target: { heading: "Intro" },
        newContent: "new text",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data.code).toBe("conflict");
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleSectionUpdate("req-2", {
        baseRevision: "rev-1",
        target: { heading: "Intro" },
        newContent: "new text",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-2",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when target is missing", async () => {
      mockGetEditor.mockReturnValue(
        createMockEditor([
          { type: "heading", level: 1, text: "Title", nodeSize: 8 },
        ])
      );

      await handleSectionUpdate("req-3", {
        baseRevision: "rev-1",
        newContent: "new text",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-3",
        success: false,
        error: "target is required",
      });
    });

    it("returns not_found when section heading does not exist", async () => {
      mockGetEditor.mockReturnValue(
        createMockEditor([
          { type: "heading", level: 1, text: "Title", nodeSize: 8 },
          { type: "paragraph", text: "Content", nodeSize: 10 },
        ])
      );

      await handleSectionUpdate("req-4", {
        baseRevision: "rev-1",
        target: { heading: "Nonexistent" },
        newContent: "new text",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data.code).toBe("not_found");
    });

    it("returns dryRun preview", async () => {
      mockGetEditor.mockReturnValue(
        createMockEditor([
          { type: "heading", level: 2, text: "Intro", nodeSize: 8 },
          { type: "paragraph", text: "Content", nodeSize: 10 },
        ])
      );

      await handleSectionUpdate("req-5", {
        baseRevision: "rev-1",
        target: { heading: "Intro" },
        newContent: "new text",
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isDryRun).toBe(true);
      expect(call.data.preview.sectionHeading).toBe("Intro");
    });
  });

  describe("handleSectionInsert", () => {
    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleSectionInsert("req-6", {
        baseRevision: "rev-1",
        after: { heading: "Intro" },
        heading: { level: 2, text: "New Section" },
        content: "content",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-6",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when heading is missing", async () => {
      mockGetEditor.mockReturnValue(
        createMockEditor([
          { type: "heading", level: 1, text: "Title", nodeSize: 8 },
        ])
      );

      await handleSectionInsert("req-7", {
        baseRevision: "rev-1",
        after: { heading: "Title" },
        content: "content",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-7",
        success: false,
        error: "heading with level and text is required",
      });
    });

    it("returns not_found when target section not found", async () => {
      mockGetEditor.mockReturnValue(
        createMockEditor([
          { type: "heading", level: 1, text: "Title", nodeSize: 8 },
        ])
      );

      await handleSectionInsert("req-8", {
        baseRevision: "rev-1",
        after: { heading: "Nonexistent" },
        heading: { level: 2, text: "New" },
        content: "content",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data.code).toBe("not_found");
    });

    it("returns revision conflict error", async () => {
      mockValidateBaseRevision.mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleSectionInsert("req-9", {
        baseRevision: "rev-old",
        after: { heading: "Intro" },
        heading: { level: 2, text: "New" },
        content: "content",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data.code).toBe("conflict");
    });
  });

  describe("handleSectionMove", () => {
    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleSectionMove("req-10", {
        baseRevision: "rev-1",
        section: { heading: "A" },
        after: { heading: "B" },
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-10",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when section target is missing", async () => {
      mockGetEditor.mockReturnValue(
        createMockEditor([
          { type: "heading", level: 1, text: "Title", nodeSize: 8 },
        ])
      );

      await handleSectionMove("req-11", {
        baseRevision: "rev-1",
        after: { heading: "Title" },
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-11",
        success: false,
        error: "section is required",
      });
    });

    it("returns dryRun preview for move", async () => {
      mockGetEditor.mockReturnValue(
        createMockEditor([
          { type: "heading", level: 2, text: "A", nodeSize: 4 },
          { type: "paragraph", text: "a content", nodeSize: 12 },
          { type: "heading", level: 2, text: "B", nodeSize: 4 },
          { type: "paragraph", text: "b content", nodeSize: 12 },
        ])
      );

      await handleSectionMove("req-12", {
        baseRevision: "rev-1",
        section: { heading: "A" },
        after: { heading: "B" },
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isDryRun).toBe(true);
      expect(call.data.preview.sectionHeading).toBe("A");
    });

    it("returns not_found when section to move does not exist", async () => {
      mockGetEditor.mockReturnValue(
        createMockEditor([
          { type: "heading", level: 1, text: "Title", nodeSize: 8 },
          { type: "paragraph", text: "Content", nodeSize: 10 },
        ])
      );

      await handleSectionMove("req-13", {
        baseRevision: "rev-1",
        section: { heading: "Nonexistent" },
        after: { heading: "Title" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toContain("not found");
    });

    it("returns revision conflict error", async () => {
      mockValidateBaseRevision.mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleSectionMove("req-14", {
        baseRevision: "rev-old",
        section: { heading: "A" },
        after: { heading: "B" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data.code).toBe("conflict");
    });
  });
});
