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
        error: "Missing or invalid 'target' (expected object, got undefined)",
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
        error: "Missing or invalid 'heading' (expected object, got undefined)",
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
        error: "Missing or invalid 'section' (expected object, got undefined)",
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

    it("returns not_found when target (after) section not found", async () => {
      mockGetEditor.mockReturnValue(
        createMockEditor([
          { type: "heading", level: 2, text: "A", nodeSize: 4 },
          { type: "paragraph", text: "a content", nodeSize: 12 },
        ])
      );

      await handleSectionMove("req-15", {
        baseRevision: "rev-1",
        section: { heading: "A" },
        after: { heading: "Nonexistent" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toContain("Target section not found");
    });

    it("no-op when moving section to itself", async () => {
      mockGetEditor.mockReturnValue(
        createMockEditor([
          { type: "heading", level: 2, text: "A", nodeSize: 4 },
          { type: "paragraph", text: "a content", nodeSize: 12 },
        ])
      );

      await handleSectionMove("req-16", {
        baseRevision: "rev-1",
        section: { heading: "A" },
        after: { heading: "A" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.warning).toContain("no move needed");
    });

    it("creates suggestions in suggest mode", async () => {
      mockGetEditor.mockReturnValue(
        createMockEditor([
          { type: "heading", level: 2, text: "A", nodeSize: 4 },
          { type: "paragraph", text: "a content", nodeSize: 12 },
          { type: "heading", level: 2, text: "B", nodeSize: 4 },
          { type: "paragraph", text: "b content", nodeSize: 12 },
        ])
      );
      mockIsAutoApproveEnabled.mockReturnValue(false);

      await handleSectionMove("req-17", {
        baseRevision: "rev-1",
        section: { heading: "A" },
        after: { heading: "B" },
        mode: "suggest",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.suggestionIds).toHaveLength(2);
      expect(call.data.warning).toContain("delete+insert");
    });

    it("moves to start of document when after is omitted", async () => {
      const editor = createMockEditor([
        { type: "heading", level: 2, text: "A", nodeSize: 4 },
        { type: "paragraph", text: "a content", nodeSize: 12 },
      ]);
      // Add replace/delete methods to tr
      editor.state.tr.replace = vi.fn().mockReturnValue(editor.state.tr);
      mockGetEditor.mockReturnValue(editor);

      await handleSectionMove("req-18", {
        baseRevision: "rev-1",
        section: { heading: "A" },
      });

      expect(editor.view.dispatch).toHaveBeenCalled();
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.movedSection).toBe("A");
    });

    it("applies move forward (section before target) in apply mode", async () => {
      const editor = createMockEditor([
        { type: "heading", level: 2, text: "A", nodeSize: 4 },
        { type: "paragraph", text: "a content", nodeSize: 12 },
        { type: "heading", level: 2, text: "B", nodeSize: 4 },
        { type: "paragraph", text: "b content", nodeSize: 12 },
      ]);
      // Add replace/delete methods to tr
      editor.state.tr.replace = vi.fn().mockReturnValue(editor.state.tr);
      mockGetEditor.mockReturnValue(editor);

      await handleSectionMove("req-19", {
        baseRevision: "rev-1",
        section: { heading: "A" },
        after: { heading: "B" },
        mode: "apply",
      });

      expect(editor.view.dispatch).toHaveBeenCalled();
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.newRevision).toBe("rev-new");
    });
  });

  describe("handleSectionUpdate — apply mode", () => {
    it("applies section update directly", async () => {
      const editor = createMockEditor([
        { type: "heading", level: 2, text: "Intro", nodeSize: 8 },
        { type: "paragraph", text: "Old content", nodeSize: 14 },
      ]);
      mockGetEditor.mockReturnValue(editor);

      await handleSectionUpdate("req-20", {
        baseRevision: "rev-1",
        target: { heading: "Intro" },
        newContent: "Updated content",
        mode: "apply",
      });

      expect(editor.view.dispatch).toHaveBeenCalled();
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.newRevision).toBe("rev-new");
      expect(call.data.sectionHeading).toBe("Intro");
    });

    it("creates suggestion in suggest mode", async () => {
      const editor = createMockEditor([
        { type: "heading", level: 2, text: "Intro", nodeSize: 8 },
        { type: "paragraph", text: "Content", nodeSize: 10 },
      ]);
      mockGetEditor.mockReturnValue(editor);
      mockIsAutoApproveEnabled.mockReturnValue(false);

      await handleSectionUpdate("req-21", {
        baseRevision: "rev-1",
        target: { heading: "Intro" },
        newContent: "New content",
        mode: "suggest",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.suggestionIds).toBeDefined();
    });
  });

  describe("handleSectionInsert — apply mode", () => {
    it("inserts section at end when no 'after' specified", async () => {
      const editor = createMockEditor([
        { type: "heading", level: 1, text: "Title", nodeSize: 8 },
        { type: "paragraph", text: "Content", nodeSize: 10 },
      ]);
      mockGetEditor.mockReturnValue(editor);

      await handleSectionInsert("req-25", {
        baseRevision: "rev-1",
        heading: { level: 2, text: "New Section" },
        content: "section content",
        mode: "apply",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.headingText).toBe("New Section");
    });

    it("returns dryRun preview for insert", async () => {
      const editor = createMockEditor([
        { type: "heading", level: 1, text: "Title", nodeSize: 8 },
      ]);
      mockGetEditor.mockReturnValue(editor);

      await handleSectionInsert("req-26", {
        baseRevision: "rev-1",
        after: { heading: "Title" },
        heading: { level: 2, text: "New" },
        content: "content",
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.isDryRun).toBe(true);
      expect(call.data.preview.headingText).toBe("New");
    });

    it("creates suggestion in suggest mode", async () => {
      const editor = createMockEditor([
        { type: "heading", level: 1, text: "Title", nodeSize: 8 },
      ]);
      mockGetEditor.mockReturnValue(editor);
      mockIsAutoApproveEnabled.mockReturnValue(false);

      await handleSectionInsert("req-27", {
        baseRevision: "rev-1",
        heading: { level: 2, text: "New" },
        content: "content",
        mode: "suggest",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.suggestionIds).toBeDefined();
    });

    it("inserts section without content (heading only)", async () => {
      const editor = createMockEditor([
        { type: "heading", level: 1, text: "Title", nodeSize: 8 },
      ]);
      mockGetEditor.mockReturnValue(editor);

      await handleSectionInsert("req-28", {
        baseRevision: "rev-1",
        heading: { level: 2, text: "Empty Section" },
        mode: "apply",
      });

      const chain = editor._chainMethods;
      expect(chain.insertContent).toHaveBeenCalled();
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
    });
  });

  describe("handleSectionUpdate — find section by byIndex", () => {
    it("finds section by level and index", async () => {
      const editor = createMockEditor([
        { type: "heading", level: 2, text: "First H2", nodeSize: 10 },
        { type: "paragraph", text: "Content 1", nodeSize: 12 },
        { type: "heading", level: 2, text: "Second H2", nodeSize: 12 },
        { type: "paragraph", text: "Content 2", nodeSize: 12 },
      ]);
      mockGetEditor.mockReturnValue(editor);

      await handleSectionUpdate("req-30", {
        baseRevision: "rev-1",
        target: { byIndex: { level: 2, index: 1 } },
        newContent: "Updated",
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.preview.sectionHeading).toBe("Second H2");
    });
  });

  describe("findSection — sectionId branch (lines 76-79)", () => {
    it("returns not_found when target uses sectionId (unimplemented — always null)", async () => {
      mockGetEditor.mockReturnValue(
        createMockEditor([
          { type: "heading", level: 1, text: "Title", nodeSize: 8 },
          { type: "paragraph", text: "Content", nodeSize: 10 },
        ])
      );

      // sectionId targeting is a no-op stub — always returns null
      await handleSectionUpdate("req-31", {
        baseRevision: "rev-1",
        target: { sectionId: "some-id" },
        newContent: "new text",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data.code).toBe("not_found");
    });
  });

  describe("handleSectionUpdate — nodesBetween return true (line 172)", () => {
    it("returns true for non-heading nodes in nodesBetween", async () => {
      // We need the nodesBetween callback to reach line 172 (return true path).
      // This happens when the first node visited is NOT at pos === section.from.
      // createMockEditor's nodesBetween visits nodes in range [from, to).
      // If the heading is at pos 0 (section.from), nodesBetween starts there and
      // hits the early return. But a paragraph coming before the heading would
      // cause a non-heading visit first.
      // The simplest approach: the nodesBetween mock in createMockEditor iterates ALL
      // nodes where pos >= from AND pos < to. Since the heading IS at section.from,
      // it hits the early return. We need a node BEFORE the heading within the range
      // which is impossible given the heading is the first node.
      // Alternative: use a section where the first node in nodesBetween is a paragraph
      // at the start position (pos === section.from but not a heading).
      // The real code: if pos === section.from AND node.type.name === "heading" → early return
      // Otherwise → return true. To trigger: a heading found at pos=0, but nodesBetween
      // also visits a paragraph node within range at pos > section.from.
      // The mock nodesBetween in createMockEditor visits nodes where pos >= from AND pos < to.
      // With heading(0..8) + para(8..18), section = {from:0, to:18}.
      // nodesBetween visits: heading at pos 0 (matches early return) → stops.
      // To get line 172: override nodesBetween to NOT match pos === section.from on first call.
      const editor = createMockEditor([
        { type: "heading", level: 2, text: "Intro", nodeSize: 8 },
        { type: "paragraph", text: "Content", nodeSize: 10 },
      ]);

      // Override nodesBetween to call callback with a paragraph first (non-heading at section.from)
      let callCount = 0;
      const originalNodesBetween = editor.state.doc.nodesBetween.bind(editor.state.doc);
      editor.state.doc.nodesBetween = (from: number, to: number, cb: (node: unknown, pos: number) => boolean | undefined) => {
        callCount++;
        // First call: invoke with a paragraph at section.from to trigger line 172
        cb({ type: { name: "paragraph" }, attrs: {}, nodeSize: 10, isText: false, textContent: "" }, from);
        // Then let the original run to ensure heading is found
        originalNodesBetween(from, to, cb);
      };

      mockGetEditor.mockReturnValue(editor);

      await handleSectionUpdate("req-32", {
        baseRevision: "rev-1",
        target: { heading: "Intro" },
        newContent: "new content",
        mode: "dryRun",
      });

      expect(callCount).toBeGreaterThan(0);
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
    });
  });

  describe("error handling — non-Error thrown (catch blocks)", () => {
    it("handleSectionUpdate converts non-Error to string (line 238)", async () => {
      // Force a non-Error throw from inside the try block
      mockValidateBaseRevision.mockImplementation(() => { throw 42; });

      await handleSectionUpdate("req-err-1", {
        baseRevision: "rev-1",
        target: { heading: "Intro" },
        newContent: "new text",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-err-1",
        success: false,
        error: "42",
      });
    });

    it("handleSectionInsert converts non-Error to string (line 379)", async () => {
      mockValidateBaseRevision.mockImplementation(() => { throw "string error"; });

      await handleSectionInsert("req-err-2", {
        baseRevision: "rev-1",
        heading: { level: 2, text: "New" },
        content: "content",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-err-2",
        success: false,
        error: "string error",
      });
    });

    it("handleSectionMove converts non-Error to string (line 562)", async () => {
      mockValidateBaseRevision.mockImplementation(() => { throw { code: 500 }; });

      await handleSectionMove("req-err-3", {
        baseRevision: "rev-1",
        section: { heading: "A" },
        after: { heading: "B" },
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-err-3",
        success: false,
        error: "[object Object]",
      });
    });
  });

  describe("findSection — heading not first in descendants (branch 0, 4, 6)", () => {
    it("handleSectionUpdate returns true for non-heading node in descendants callback", async () => {
      // This tests the `return true` branch in the descendants callback when
      // a non-heading node is visited (the iterator continues past it).
      const editor = createMockEditor([
        { type: "paragraph", text: "Intro text", nodeSize: 12 },
        { type: "heading", level: 2, text: "Section", nodeSize: 10 },
        { type: "paragraph", text: "Content", nodeSize: 10 },
      ]);
      mockGetEditor.mockReturnValue(editor);

      await handleSectionUpdate("req-desc-1", {
        baseRevision: "rev-1",
        target: { heading: "Section" },
        newContent: "new content",
        mode: "dryRun",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.preview.sectionHeading).toBe("Section");
    });
  });

  describe("handleSectionMove — target inside moving section (lines 458-465)", () => {
    it("returns invalid_operation when target is inside the section being moved", async () => {
      // We need afterSection.to > sectionRange.from && afterSection.to < sectionRange.to
      // This requires two sections where the "after" section ends inside the "section" being moved.
      // Create a doc where:
      //   - "A" section: from=0, to=32 (covers nodes 0..32)
      //   - "B" section starts and ends INSIDE "A" (nested section)
      // Use 4 nodes: headingA(0..8), headingB(8..16), paraB(16..24), paraA(24..32)
      // section A from=0, to=doc.size=32
      // section B from=8, to=24 (ends before next same-level heading which is paraA at 24)
      // Actually headingA is level 1, headingB is level 2: section B is nested inside A
      // Move B "after B" would be self-move, that's caught earlier.
      // We need "after" section whose .to is INSIDE the "section" being moved.
      // Let's try: "move A after B" where B ends inside A. But A starts at 0 (contains B).
      // sectionRange for "A": from=0, to=32
      // afterSection for "B": from=8, to=24 (inside A)
      // Check: afterSection.to=24 > sectionRange.from=0 AND 24 < sectionRange.to=32 → TRUE → error

      // Layout: H1-A (0..8), H2-B (8..16), para-b (16..24), H1-C (24..32), para-c (32..40)
      // sectionRange for "A" (L1, from=0): next L1 heading = H1-C at pos=24 → to=24
      // afterSection for "B" (L2, from=8): next L2 heading = none, but H1-C at pos=24 has L1 ≤ 2 → to=24
      // Guard: afterSection.to=24 > sectionRange.from=0 ✓ AND afterSection.to=24 < sectionRange.to=24 ✗ (equal)
      // Actually equal won't work. Need afterSection.to strictly inside sectionRange.
      // Use: H1-A (0..8), H2-B (8..16), para-b (16..20), H2-C (20..28), para-a-end (28..36)
      // sectionRange for "A" (L1): no L1 heading after it → to=36 (doc size)
      // afterSection for "B" (L2, from=8): next L2 heading = H2-C at pos=20 → to=20
      // Guard: afterSection.to=20 > sectionRange.from=0 ✓ AND 20 < 36 ✓ → fires!
      const editor = createMockEditor([
        { type: "heading", level: 1, text: "A", nodeSize: 8 },
        { type: "heading", level: 2, text: "B", nodeSize: 8 },
        { type: "paragraph", text: "b content", nodeSize: 4 },
        { type: "heading", level: 2, text: "C", nodeSize: 8 },
        { type: "paragraph", text: "a-end content", nodeSize: 8 },
      ]);
      mockGetEditor.mockReturnValue(editor);

      // Move "A" (from=0, to=36) after "B" (from=8, to=20).
      // afterSection.to=20 is inside sectionRange (0..36) → invalid_operation
      await handleSectionMove("req-33", {
        baseRevision: "rev-1",
        section: { heading: "A" },
        after: { heading: "B" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data?.code).toBe("invalid_operation");
    });
  });
});
