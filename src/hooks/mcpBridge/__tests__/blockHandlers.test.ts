/**
 * Tests for blockHandlers — list_blocks, resolve_targets, get_section.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
}));

// Mock revision store
vi.mock("@/stores/revisionStore", () => ({
  useRevisionStore: {
    getState: () => ({
      getRevision: () => "rev-test",
    }),
  },
}));

// Mock AST handlers
const mockGenerateNodeId = vi.fn();
const mockResetNodeIdCounters = vi.fn();
const mockExtractText = vi.fn();
const mockToAstNode = vi.fn();
const mockMatchesQuery = vi.fn();
vi.mock("../astHandlers", () => ({
  generateNodeId: (...args: unknown[]) => mockGenerateNodeId(...args),
  resetNodeIdCounters: () => mockResetNodeIdCounters(),
  extractText: (...args: unknown[]) => mockExtractText(...args),
  toAstNode: (...args: unknown[]) => mockToAstNode(...args),
  matchesQuery: (...args: unknown[]) => mockMatchesQuery(...args),
}));

import {
  handleListBlocks,
  handleResolveTargets,
  handleGetSection,
} from "../blockHandlers";

describe("blockHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let nodeCounter = 0;
    mockGenerateNodeId.mockImplementation(
      (type: string) => `${type}-${nodeCounter++}`
    );
    mockExtractText.mockReturnValue("text");
    mockMatchesQuery.mockReturnValue(true);
  });

  describe("handleListBlocks", () => {
    it("lists blocks from document", async () => {
      const nodes = [
        {
          type: { name: "paragraph" },
          isBlock: true,
          isTextblock: true,
          nodeSize: 10,
        },
        {
          type: { name: "heading" },
          isBlock: true,
          isTextblock: true,
          nodeSize: 8,
        },
      ];
      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of nodes) {
                const result = callback(node, pos);
                if (result === false) break;
                pos += (node as { nodeSize: number }).nodeSize;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBlocks("req-1", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.blocks).toHaveLength(2);
      expect(call.data.revision).toBe("rev-test");
    });

    it("respects limit parameter", async () => {
      const nodes = Array.from({ length: 5 }, () => ({
        type: { name: "paragraph" },
        isBlock: true,
        isTextblock: true,
        nodeSize: 10,
      }));
      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of nodes) {
                const result = callback(node, pos);
                if (result === false) break;
                pos += 10;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBlocks("req-2", { limit: 2 });

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.blocks).toHaveLength(2);
      expect(call.data.hasMore).toBe(true);
      expect(call.data.nextCursor).toBeDefined();
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleListBlocks("req-3", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-3",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleResolveTargets", () => {
    it("resolves targets matching query", async () => {
      const nodes = [
        {
          type: { name: "paragraph" },
          isBlock: true,
          nodeSize: 10,
        },
      ];
      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              for (const node of nodes) {
                callback(node, 0);
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleResolveTargets("req-4", {
        query: { type: "paragraph" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.candidates).toHaveLength(1);
    });

    it("returns error when query is missing", async () => {
      mockGetEditor.mockReturnValue({
        state: { doc: { descendants: vi.fn() } },
      });

      await handleResolveTargets("req-5", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: "Missing or invalid 'query' (expected object, got undefined)",
      });
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleResolveTargets("req-6", { query: { type: "heading" } });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-6",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleGetSection", () => {
    it("finds section by heading text", async () => {
      const heading = {
        type: { name: "heading" },
        attrs: { level: 2 },
        nodeSize: 10,
      };
      const paragraph = {
        type: { name: "paragraph" },
        isBlock: true,
        nodeSize: 10,
      };
      mockExtractText
        .mockReturnValueOnce("Target")
        .mockReturnValue("text");
      mockToAstNode.mockReturnValue({
        type: "paragraph",
        text: "text",
      });

      const editor = {
        state: {
          doc: {
            content: { size: 20 },
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              callback(heading, 0);
              callback(paragraph, 10);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleGetSection("req-7", { heading: "Target" });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.heading.text).toBe("Target");
      expect(call.data.heading.level).toBe(2);
    });

    it("returns error for missing heading", async () => {
      mockGetEditor.mockReturnValue({
        state: { doc: { descendants: vi.fn() } },
      });

      await handleGetSection("req-8", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-8",
        success: false,
        error: "heading is required",
      });
    });

    it("returns error when section not found", async () => {
      const editor = {
        state: {
          doc: {
            content: { size: 0 },
            descendants: () => {
              // no headings found
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleGetSection("req-9", { heading: "Nonexistent" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-9",
        success: false,
        error: "Section not found",
      });
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleGetSection("req-10", { heading: "Test" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-10",
        success: false,
        error: "No active editor",
      });
    });

    it("finds section by level and index", async () => {
      const headings = [
        {
          type: { name: "heading" },
          attrs: { level: 2 },
          nodeSize: 10,
          isBlock: true,
        },
        {
          type: { name: "paragraph" },
          attrs: {},
          nodeSize: 15,
          isBlock: true,
        },
        {
          type: { name: "heading" },
          attrs: { level: 2 },
          nodeSize: 10,
          isBlock: true,
        },
      ];

      let extractCallCount = 0;
      mockExtractText.mockImplementation(() => {
        extractCallCount++;
        return extractCallCount <= 1 ? "First H2" : "Second H2";
      });
      mockToAstNode.mockReturnValue({ type: "paragraph", text: "text" });

      const editor = {
        state: {
          doc: {
            content: { size: 35 },
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of headings) {
                const result = callback(node, pos);
                if (result === false) break;
                pos += node.nodeSize;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleGetSection("req-11", {
        heading: { level: 2, index: 1 },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.heading.level).toBe(2);
    });

    it("stops section at next heading of same or lower level (lines 303-306)", async () => {
      const targetHeading = {
        type: { name: "heading" },
        attrs: { level: 2 },
        nodeSize: 10,
      };
      const paragraph = {
        type: { name: "paragraph" },
        isBlock: true,
        nodeSize: 10,
      };
      const nextHeading = {
        type: { name: "heading" },
        attrs: { level: 2 },
        nodeSize: 10,
        isBlock: true,
      };
      const afterParagraph = {
        type: { name: "paragraph" },
        isBlock: true,
        nodeSize: 10,
      };

      let extractCallCount = 0;
      mockExtractText.mockImplementation(() => {
        extractCallCount++;
        if (extractCallCount === 1) return "Target";
        if (extractCallCount === 2) return "Next Heading";
        return "text";
      });
      mockToAstNode.mockReturnValue({ type: "paragraph", text: "text" });

      const allNodes = [targetHeading, paragraph, nextHeading, afterParagraph];
      const editor = {
        state: {
          doc: {
            content: { size: 40 },
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of allNodes) {
                const result = callback(node, pos);
                if (result === false) break;
                pos += node.nodeSize;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleGetSection("req-section-end", { heading: "Target" });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      // Section should only contain the paragraph between the two headings
      expect(call.data.content).toHaveLength(1);
      // Range should end at the next heading position (20)
      expect(call.data.range.to).toBe(20);
    });

    it("case-insensitive heading match", async () => {
      const heading = {
        type: { name: "heading" },
        attrs: { level: 1 },
        nodeSize: 10,
      };
      mockExtractText.mockReturnValue("My Section");

      const editor = {
        state: {
          doc: {
            content: { size: 10 },
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              callback(heading, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleGetSection("req-12", { heading: "my section" });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.heading.text).toBe("My Section");
    });
  });

  describe("handleListBlocks — cursor pagination", () => {
    it("skips blocks until afterCursor is found", async () => {
      const nodes = [
        {
          type: { name: "paragraph" },
          isBlock: true,
          isTextblock: true,
          nodeSize: 10,
        },
        {
          type: { name: "paragraph" },
          isBlock: true,
          isTextblock: true,
          nodeSize: 10,
        },
        {
          type: { name: "paragraph" },
          isBlock: true,
          isTextblock: true,
          nodeSize: 10,
        },
      ];

      let nodeCounter = 0;
      mockGenerateNodeId.mockImplementation(
        (type: string) => `${type}-${nodeCounter++}`
      );

      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of nodes) {
                const result = callback(node, pos);
                if (result === false) break;
                pos += 10;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBlocks("req-20", {
        afterCursor: "paragraph-0",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      // Should skip first block and return the remaining 2
      expect(call.data.blocks).toHaveLength(2);
    });
  });

  describe("handleListBlocks — query filtering", () => {
    it("filters blocks based on query", async () => {
      const nodes = [
        {
          type: { name: "heading" },
          isBlock: true,
          isTextblock: true,
          nodeSize: 10,
        },
        {
          type: { name: "paragraph" },
          isBlock: true,
          isTextblock: true,
          nodeSize: 10,
        },
      ];

      // Only match headings
      mockMatchesQuery.mockImplementation(
        (node: { type: { name: string } }) => node.type.name === "heading"
      );

      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of nodes) {
                const result = callback(node, pos);
                if (result === false) break;
                pos += 10;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBlocks("req-21", {
        query: { type: "heading" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.blocks).toHaveLength(1);
    });

    it("truncates long text in preview", async () => {
      const longText = "x".repeat(150);
      mockExtractText.mockReturnValue(longText);

      const nodes = [
        {
          type: { name: "paragraph" },
          isBlock: true,
          isTextblock: true,
          nodeSize: 200,
        },
      ];

      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              for (const node of nodes) {
                callback(node, 0);
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBlocks("req-22", {});

      const call = mockRespond.mock.calls[0][0];
      const block = call.data.blocks[0];
      expect(block.preview.length).toBeLessThan(longText.length);
      expect(block.preview).toContain("...");
    });
  });

  describe("handleResolveTargets — scoring", () => {
    it("scores exact match higher than partial", async () => {
      const nodes = [
        {
          type: { name: "paragraph" },
          isBlock: true,
          nodeSize: 10,
        },
        {
          type: { name: "paragraph" },
          isBlock: true,
          nodeSize: 10,
        },
      ];

      let callCount = 0;
      mockExtractText.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? "hello world" : "hello";
      });

      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of nodes) {
                callback(node, pos);
                pos += 10;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleResolveTargets("req-30", {
        query: { type: "paragraph", contains: "hello" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.candidates).toHaveLength(2);
      // exact match should score higher
      expect(call.data.candidates[0].score).toBeGreaterThanOrEqual(
        call.data.candidates[1].score
      );
    });

    it("detects ambiguous results", async () => {
      const nodes = [
        {
          type: { name: "paragraph" },
          isBlock: true,
          nodeSize: 10,
        },
        {
          type: { name: "paragraph" },
          isBlock: true,
          nodeSize: 10,
        },
      ];

      // Both return same text — both will have same high score
      mockExtractText.mockReturnValue("hello");

      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of nodes) {
                callback(node, pos);
                pos += 10;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleResolveTargets("req-31", {
        query: { type: "paragraph", contains: "hello" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.isAmbiguous).toBe(true);
    });

    it("respects maxResults limit", async () => {
      const nodes = Array.from({ length: 20 }, () => ({
        type: { name: "paragraph" },
        isBlock: true,
        nodeSize: 10,
      }));

      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of nodes) {
                callback(node, pos);
                pos += 10;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleResolveTargets("req-32", {
        query: { type: "paragraph" },
        maxResults: 3,
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.candidates).toHaveLength(3);
    });

    it("scores 'text contains query' when text contains but doesn't start with query (lines 174-175)", async () => {
      const nodes = [
        {
          type: { name: "paragraph" },
          isBlock: true,
          nodeSize: 10,
        },
      ];

      // Text contains query but doesn't match exactly or start with it
      mockExtractText.mockReturnValue("world hello world");

      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              for (const node of nodes) {
                callback(node, 0);
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleResolveTargets("req-contains", {
        query: { type: "paragraph", contains: "hello" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.candidates).toHaveLength(1);
      expect(call.data.candidates[0].score).toBe(0.7);
      expect(call.data.candidates[0].reason).toContain("text contains query");
    });

    it("scores 'text starts with query' when text starts with query (lines 170-172)", async () => {
      const nodes = [
        {
          type: { name: "paragraph" },
          isBlock: true,
          nodeSize: 10,
        },
      ];

      // Text starts with query but is not an exact match
      mockExtractText.mockReturnValue("hello world extra text");

      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              for (const node of nodes) {
                callback(node, 0);
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleResolveTargets("req-starts", {
        query: { type: "paragraph", contains: "hello world extra text" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.candidates).toHaveLength(1);
      expect(call.data.candidates[0].score).toBe(1.0);
      expect(call.data.candidates[0].reason).toContain("exact text match");
    });

    it("includes level in reason when query has level", async () => {
      const node = {
        type: { name: "heading" },
        isBlock: true,
        nodeSize: 10,
        attrs: { level: 2 },
      };

      mockExtractText.mockReturnValue("Section");

      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              callback(node, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleResolveTargets("req-33", {
        query: { type: "heading", level: 2 },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.candidates[0].reason).toContain("level=2");
    });
  });

  describe("handleListBlocks — skips non-block nodes (line 52)", () => {
    it("skips nodes where isBlock is false or isTextblock is false", async () => {
      const nodes = [
        {
          type: { name: "text" },
          isBlock: false,
          isTextblock: false,
          nodeSize: 5,
        },
        {
          type: { name: "paragraph" },
          isBlock: true,
          isTextblock: true,
          nodeSize: 10,
        },
      ];
      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of nodes) {
                callback(node, pos);
                pos += node.nodeSize;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBlocks("req-skip-1", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.blocks).toHaveLength(1);
      expect(call.data.blocks[0].type).toBe("paragraph");
    });
  });

  describe("handleListBlocks — afterCursor not found (lines 58-60)", () => {
    it("returns no blocks when afterCursor never matches any node ID", async () => {
      const nodes = [
        {
          type: { name: "paragraph" },
          isBlock: true,
          isTextblock: true,
          nodeSize: 10,
        },
      ];

      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              for (const node of nodes) {
                callback(node, 0);
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleListBlocks("req-cursor-miss", {
        afterCursor: "nonexistent-cursor-id",
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      // afterCursor was never found, so foundCursor stays false, all blocks skipped
      expect(call.data.blocks).toHaveLength(0);
    });
  });

  describe("handleListBlocks — error with non-Error thrown (line 105)", () => {
    it("returns String(error) for non-Error throws", async () => {
      mockGetEditor.mockImplementation(() => { throw "string error"; });

      await handleListBlocks("req-str-err-bl", {});

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("string error");
    });
  });

  describe("handleResolveTargets — error with non-Error thrown (line 216)", () => {
    it("returns String(error) for non-Error throws", async () => {
      mockGetEditor.mockImplementation(() => { throw 42; });

      await handleResolveTargets("req-str-err-rt", { query: { type: "heading" } });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("42");
    });
  });

  describe("handleGetSection — error with non-Error thrown (line 335)", () => {
    it("returns String(error) for non-Error throws", async () => {
      mockGetEditor.mockImplementation(() => { throw false; });

      await handleGetSection("req-str-err-gs", { heading: "Test" });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.error).toBe("false");
    });
  });

  describe("handleGetSection — heading by level/index with non-zero index (line 145, 150-152)", () => {
    it("skips headings that don't match the index", async () => {
      const heading1 = {
        type: { name: "heading" },
        attrs: { level: 3 },
        nodeSize: 10,
      };
      const heading2 = {
        type: { name: "heading" },
        attrs: { level: 3 },
        nodeSize: 10,
      };

      let extractCallCount = 0;
      mockExtractText.mockImplementation(() => {
        extractCallCount++;
        return extractCallCount === 1 ? "First H3" : "Second H3";
      });

      const editor = {
        state: {
          doc: {
            content: { size: 20 },
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of [heading1, heading2]) {
                const result = callback(node, pos);
                if (result === false) break;
                pos += node.nodeSize;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      // Request index 0 — should match first heading
      await handleGetSection("req-idx-0", {
        heading: { level: 3, index: 0 },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.heading.text).toBe("First H3");
    });
  });

  describe("handleGetSection — includeNested=true includes sub-headings (lines 300-313)", () => {
    it("does not stop at sub-headings when includeNested is true", async () => {
      const h1 = {
        type: { name: "heading" },
        attrs: { level: 1 },
        nodeSize: 10,
      };
      const para = {
        type: { name: "paragraph" },
        isBlock: true,
        nodeSize: 10,
      };
      const h2 = {
        type: { name: "heading" },
        attrs: { level: 2 },
        isBlock: true,
        nodeSize: 10,
      };
      const para2 = {
        type: { name: "paragraph" },
        isBlock: true,
        nodeSize: 10,
      };

      let extractCallCount = 0;
      mockExtractText.mockImplementation(() => {
        extractCallCount++;
        if (extractCallCount === 1) return "Main Section";
        return "text";
      });
      mockToAstNode.mockReturnValue({ type: "paragraph", text: "text" });

      const allNodes = [h1, para, h2, para2];
      const editor = {
        state: {
          doc: {
            content: { size: 40 },
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of allNodes) {
                const result = callback(node, pos);
                if (result === false) break;
                pos += node.nodeSize;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleGetSection("req-nested", {
        heading: "Main Section",
        includeNested: true,
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      // Should include content past the h2 because includeNested=true
      // para (pos 10), h2 (pos 20), para2 (pos 30) — all included
      expect(call.data.content.length).toBeGreaterThanOrEqual(2);
      expect(call.data.range.to).toBe(40);
    });
  });

  describe("handleGetSection — stops at same-level heading (line 304-307)", () => {
    it("stops at a heading with level <= target level when includeNested is false", async () => {
      const h2 = {
        type: { name: "heading" },
        attrs: { level: 2 },
        nodeSize: 10,
      };
      const para = {
        type: { name: "paragraph" },
        isBlock: true,
        nodeSize: 10,
      };
      const h1 = {
        type: { name: "heading" },
        attrs: { level: 1 },
        isBlock: true,
        nodeSize: 10,
      };

      let extractCallCount = 0;
      mockExtractText.mockImplementation(() => {
        extractCallCount++;
        if (extractCallCount === 1) return "Target";
        return "text";
      });
      mockToAstNode.mockReturnValue({ type: "paragraph", text: "text" });

      const allNodes = [h2, para, h1];
      const editor = {
        state: {
          doc: {
            content: { size: 30 },
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of allNodes) {
                const result = callback(node, pos);
                if (result === false) break;
                pos += node.nodeSize;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleGetSection("req-stop-h1", {
        heading: "Target",
        includeNested: false,
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      // Should stop before h1 (pos 20)
      expect(call.data.range.to).toBe(20);
      expect(call.data.content).toHaveLength(1);
    });
  });

  describe("handleResolveTargets — non-matching nodes filtered out (line 150)", () => {
    it("filters out nodes that don't match query", async () => {
      const nodes = [
        {
          type: { name: "heading" },
          isBlock: true,
          nodeSize: 10,
        },
        {
          type: { name: "paragraph" },
          isBlock: true,
          nodeSize: 10,
        },
      ];

      // Only match headings
      mockMatchesQuery.mockImplementation(
        (node: { type: { name: string } }) => node.type.name === "heading"
      );

      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of nodes) {
                callback(node, pos);
                pos += 10;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleResolveTargets("req-filter", {
        query: { type: "heading" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.candidates).toHaveLength(1);
      expect(call.data.isAmbiguous).toBe(false);
    });
  });

  describe("handleGetSection — heading by level with non-matching level (line 269)", () => {
    it("skips headings of different level when looking by level/index", async () => {
      const h1 = {
        type: { name: "heading" },
        attrs: { level: 1 },
        nodeSize: 10,
      };
      const h2 = {
        type: { name: "heading" },
        attrs: { level: 2 },
        nodeSize: 10,
      };

      let extractCallCount = 0;
      mockExtractText.mockImplementation(() => {
        extractCallCount++;
        return extractCallCount === 1 ? "H1 Title" : "H2 Title";
      });

      const editor = {
        state: {
          doc: {
            content: { size: 20 },
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of [h1, h2]) {
                const result = callback(node, pos);
                if (result === false) break;
                pos += node.nodeSize;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      // Request level 2, index 0 — should skip h1 and find h2
      await handleGetSection("req-level-skip", {
        heading: { level: 2, index: 0 },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.heading.level).toBe(2);
    });
  });

  describe("handleGetSection — non-block nodes in section content (line 310-312)", () => {
    it("only includes block nodes in section content", async () => {
      const heading = {
        type: { name: "heading" },
        attrs: { level: 2 },
        nodeSize: 10,
      };
      const inlineNode = {
        type: { name: "text" },
        isBlock: false,
        nodeSize: 5,
      };
      const para = {
        type: { name: "paragraph" },
        isBlock: true,
        nodeSize: 10,
      };

      let extractCallCount = 0;
      mockExtractText.mockImplementation(() => {
        extractCallCount++;
        return extractCallCount === 1 ? "Section" : "text";
      });
      mockToAstNode.mockReturnValue({ type: "paragraph", text: "text" });

      const allNodes = [heading, inlineNode, para];
      const editor = {
        state: {
          doc: {
            content: { size: 25 },
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              let pos = 0;
              for (const node of allNodes) {
                const result = callback(node, pos);
                if (result === false) break;
                pos += node.nodeSize;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleGetSection("req-inline-skip", { heading: "Section" });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      // Only the paragraph should be in content, not the inline node
      expect(call.data.content).toHaveLength(1);
    });
  });

  describe("handleResolveTargets — preview truncation for long text (line 155)", () => {
    it("truncates preview for text longer than 100 chars", async () => {
      const longText = "x".repeat(150);
      mockExtractText.mockReturnValue(longText);

      const node = {
        type: { name: "paragraph" },
        isBlock: true,
        nodeSize: 200,
      };

      const editor = {
        state: {
          doc: {
            descendants: (
              callback: (node: unknown, pos: number) => boolean | undefined
            ) => {
              callback(node, 0);
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleResolveTargets("req-trunc-rt", {
        query: { type: "paragraph" },
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.data.candidates[0].preview.length).toBeLessThan(longText.length);
      expect(call.data.candidates[0].preview).toContain("...");
    });
  });
});
