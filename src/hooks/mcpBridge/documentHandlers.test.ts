/**
 * MCP Bridge — Document Handler Tests
 *
 * Tests for document.getContent, document.search, outline.get, and metadata.get.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleGetContent,
  handleDocumentSearch,
  handleOutlineGet,
  handleMetadataGet,
} from "./documentHandlers";

vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
  getDocumentContent: vi.fn(),
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(() => ({
      activeTabId: { main: "tab-1" },
      tabs: { main: [{ id: "tab-1", title: "Test Doc", filePath: "/test.md" }] },
    })),
  },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(() => ({
      getDocument: vi.fn(() => ({
        filePath: "/test.md",
        isDirty: false,
      })),
    })),
  },
}));

import { respond, getEditor, getDocumentContent } from "./utils";

describe("documentHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleGetContent", () => {
    it("returns document content", async () => {
      vi.mocked(getDocumentContent).mockReturnValue("# Hello\n\nWorld");

      await handleGetContent("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: "# Hello\n\nWorld",
      });
    });

    it("returns error when getDocumentContent throws", async () => {
      vi.mocked(getDocumentContent).mockImplementation(() => {
        throw new Error("No active editor");
      });

      await handleGetContent("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleDocumentSearch", () => {
    it("finds matches in document text", async () => {
      vi.mocked(getEditor).mockReturnValue({
        state: {
          doc: { textContent: "hello world hello" },
        },
      } as never);

      await handleDocumentSearch("req-1", { query: "hello" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({ position: 0, line: 1 }),
          expect.objectContaining({ position: 12, line: 1 }),
        ]),
      });
    });

    it("returns empty array when no matches", async () => {
      vi.mocked(getEditor).mockReturnValue({
        state: {
          doc: { textContent: "hello world" },
        },
      } as never);

      await handleDocumentSearch("req-1", { query: "nonexistent" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: [],
      });
    });

    it("supports case-sensitive search", async () => {
      vi.mocked(getEditor).mockReturnValue({
        state: {
          doc: { textContent: "Hello hello" },
        },
      } as never);

      await handleDocumentSearch("req-1", { query: "Hello", caseSensitive: true });

      const call = vi.mocked(respond).mock.calls[0][0];
      expect(call.success).toBe(true);
      expect((call.data as Array<unknown>).length).toBe(1);
    });

    it("returns error when query is not a string", async () => {
      vi.mocked(getEditor).mockReturnValue({
        state: { doc: { textContent: "" } },
      } as never);

      await handleDocumentSearch("req-1", { query: 123 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "query must be a string",
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleDocumentSearch("req-1", { query: "test" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleOutlineGet", () => {
    it("extracts headings from document", async () => {
      const headings: Array<{ level: number; text: string; pos: number }> = [];
      vi.mocked(getEditor).mockReturnValue({
        state: {
          doc: {
            descendants: vi.fn((cb: (node: Record<string, unknown>, pos: number) => void) => {
              cb({ type: { name: "heading" }, attrs: { level: 1 }, textContent: "Title" }, 0);
              cb({ type: { name: "paragraph" }, attrs: {}, textContent: "Body" }, 10);
              cb({ type: { name: "heading" }, attrs: { level: 2 }, textContent: "Section" }, 20);
              // Keep headings for assertion
              headings.push({ level: 1, text: "Title", pos: 0 });
              headings.push({ level: 2, text: "Section", pos: 20 });
            }),
          },
        },
      } as never);

      await handleOutlineGet("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({ level: 1, text: "Title" }),
          expect.objectContaining({ level: 2, text: "Section" }),
        ]),
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleOutlineGet("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleMetadataGet", () => {
    it("returns document metadata", async () => {
      vi.mocked(getEditor).mockReturnValue({
        state: {
          doc: {
            textContent: "hello world foo bar",
            descendants: vi.fn((cb: (node: Record<string, unknown>) => boolean | void) => {
              cb({ type: { name: "heading" }, attrs: { level: 1 }, textContent: "My Title" });
            }),
          },
        },
      } as never);

      await handleMetadataGet("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          filePath: "/test.md",
          title: "My Title",
          wordCount: 4,
          characterCount: 19,
          isModified: false,
        }),
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleMetadataGet("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });
});
