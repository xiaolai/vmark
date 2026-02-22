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
        error: "query is required",
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
  });
});
