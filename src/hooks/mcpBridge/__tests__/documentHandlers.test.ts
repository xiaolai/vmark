/**
 * Tests for documentHandlers — document.getContent, document.search,
 * outline.get, and metadata.get.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock workspaceStorage — must be before documentHandlers import
vi.mock("@/utils/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

// Mock utils
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
const mockGetDocumentContent = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
  getDocumentContent: () => mockGetDocumentContent(),
}));

// Mock stores
const mockTabStoreState = {
  activeTabId: { main: "tab-1" },
  tabs: { main: [{ id: "tab-1", title: "Test Doc", filePath: "/test.md" }] },
};
vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => mockTabStoreState,
  },
}));

const mockDocStoreState = {
  getDocument: vi.fn().mockReturnValue({
    filePath: "/test.md",
    isDirty: false,
  }),
};
vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => mockDocStoreState,
  },
}));

import {
  handleGetContent,
  handleDocumentSearch,
  handleOutlineGet,
  handleMetadataGet,
} from "../documentHandlers";

describe("documentHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleGetContent", () => {
    it("returns document content", async () => {
      mockGetDocumentContent.mockReturnValue("# Hello\n\nWorld");

      await handleGetContent("req-1");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: "# Hello\n\nWorld",
      });
    });

    it("returns error when getDocumentContent throws", async () => {
      mockGetDocumentContent.mockImplementation(() => {
        throw new Error("No active editor");
      });

      await handleGetContent("req-2");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-2",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleDocumentSearch", () => {
    it("finds text matches with positions and line numbers", async () => {
      const editor = {
        state: {
          doc: { textContent: "Hello world\nHello again" },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleDocumentSearch("req-3", { query: "Hello" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-3",
        success: true,
        data: [
          { position: 0, line: 1, text: "Hello world" },
          { position: 12, line: 2, text: "Hello again" },
        ],
      });
    });

    it("supports case-sensitive search", async () => {
      const editor = {
        state: {
          doc: { textContent: "Hello hello HELLO" },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleDocumentSearch("req-4", {
        query: "Hello",
        caseSensitive: true,
      });

      const data = mockRespond.mock.calls[0][0].data;
      expect(data).toHaveLength(1);
      expect(data[0].position).toBe(0);
    });

    it("returns error for non-string query", async () => {
      mockGetEditor.mockReturnValue({ state: { doc: { textContent: "" } } });

      await handleDocumentSearch("req-5", { query: 123 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: expect.stringContaining("Missing or invalid 'query'"),
      });
    });

    it("returns empty array when no matches", async () => {
      const editor = {
        state: { doc: { textContent: "Hello world" } },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleDocumentSearch("req-6", { query: "xyz" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-6",
        success: true,
        data: [],
      });
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleDocumentSearch("req-7", { query: "test" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-7",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleOutlineGet", () => {
    it("extracts headings from document", async () => {
      const headings = [
        { type: { name: "heading" }, attrs: { level: 1 }, textContent: "Title" },
        { type: { name: "paragraph" }, textContent: "text" },
        { type: { name: "heading" }, attrs: { level: 2 }, textContent: "Section" },
      ];
      const editor = {
        state: {
          doc: {
            descendants: (callback: (node: unknown, pos: number) => void) => {
              let pos = 0;
              for (const h of headings) {
                callback(h, pos);
                pos += 10;
              }
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleOutlineGet("req-8");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-8",
        success: true,
        data: [
          { level: 1, text: "Title", position: 0 },
          { level: 2, text: "Section", position: 20 },
        ],
      });
    });

    it("returns empty array for document with no headings", async () => {
      const editor = {
        state: {
          doc: {
            descendants: () => {
              // no headings
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleOutlineGet("req-9");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-9",
        success: true,
        data: [],
      });
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleOutlineGet("req-10");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-10",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("handleMetadataGet", () => {
    it("returns document metadata", async () => {
      const editor = {
        state: {
          doc: {
            textContent: "Hello world test",
            descendants: () => {
              // no headings
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleMetadataGet("req-11");

      const call = mockRespond.mock.calls[0][0];
      expect(call.id).toBe("req-11");
      expect(call.success).toBe(true);
      expect(call.data.filePath).toBe("/test.md");
      expect(call.data.wordCount).toBe(3);
      expect(call.data.characterCount).toBe(16);
      expect(call.data.isModified).toBe(false);
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleMetadataGet("req-12");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-12",
        success: false,
        error: "No active editor",
      });
    });

    it("returns error when no active tab (lines 141-143)", async () => {
      // Set activeTabId to null to trigger the !activeTabId branch
      const _origActiveTabId = mockTabStoreState.activeTabId;
      (mockTabStoreState.activeTabId as unknown as Record<string, string | null>)["main"] = null;

      const editor = {
        state: {
          doc: {
            textContent: "Hello",
            descendants: () => {},
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleMetadataGet("req-13");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-13",
        success: false,
        error: "No active document",
      });

      // Restore
      (mockTabStoreState.activeTabId as unknown as Record<string, string | null>)["main"] = "tab-1";
    });

    it("extracts h1 heading as document title (lines 155-159)", async () => {
      // descendants visits a heading with level 1 → title overrides tab.title
      let _titleOverrideCallback: ((node: unknown) => boolean | void) | null = null;
      const editor = {
        state: {
          doc: {
            textContent: "My Heading",
            descendants: (cb: (node: unknown) => boolean | void) => {
              _titleOverrideCallback = cb;
              // Call cb with a level-1 heading to trigger title override
              const result = cb({
                type: { name: "heading" },
                attrs: { level: 1 },
                textContent: "My Document Title",
              });
              if (result === false) return; // stop traversal
            },
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleMetadataGet("req-14");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.title).toBe("My Document Title");
    });

    it("returns wordCount 0 for empty text", async () => {
      const editor = {
        state: {
          doc: {
            textContent: "",
            descendants: () => {},
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleMetadataGet("req-empty-text");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.wordCount).toBe(0);
      expect(call.data.characterCount).toBe(0);
    });

    it("returns Untitled when tab is not found in tabs array", async () => {
      // Set tabs to empty array so tab lookup returns undefined
      const origTabs = mockTabStoreState.tabs;
      mockTabStoreState.tabs = { main: [] };

      const editor = {
        state: {
          doc: {
            textContent: "some text",
            descendants: () => {},
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleMetadataGet("req-no-tab");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.title).toBe("Untitled");

      mockTabStoreState.tabs = origTabs;
    });

    it("returns null filePath and false isModified when document not found", async () => {
      mockDocStoreState.getDocument.mockReturnValueOnce(null);

      const editor = {
        state: {
          doc: {
            textContent: "test",
            descendants: () => {},
          },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleMetadataGet("req-no-doc");

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.filePath).toBeNull();
      expect(call.data.isModified).toBe(false);
    });

    it("handles non-Error thrown value (String(error) branch)", async () => {
      mockGetEditor.mockImplementation(() => {
        throw 42;      });

      await handleMetadataGet("req-ne-meta");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ne-meta",
        success: false,
        error: "42",
      });
    });
  });

  // ── non-Error catch branches for getContent, search, outline ──

  describe("handleGetContent — non-Error catch branch", () => {
    it("handles non-Error thrown value", async () => {
      mockGetDocumentContent.mockImplementation(() => {
        throw "raw string";      });

      await handleGetContent("req-ne-gc");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ne-gc",
        success: false,
        error: "raw string",
      });
    });
  });

  describe("handleDocumentSearch — non-Error catch branch", () => {
    it("handles non-Error thrown value", async () => {
      mockGetEditor.mockImplementation(() => {
        throw null;      });

      await handleDocumentSearch("req-ne-ds", { query: "x" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ne-ds",
        success: false,
        error: "null",
      });
    });
  });

  describe("handleOutlineGet — non-Error catch branch", () => {
    it("handles non-Error thrown value", async () => {
      mockGetEditor.mockImplementation(() => {
        throw false;      });

      await handleOutlineGet("req-ne-og");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-ne-og",
        success: false,
        error: "false",
      });
    });
  });

  describe("handleDocumentSearch — lineEnd === -1 branch (no newline after match)", () => {
    it("handles match at end of text without trailing newline", async () => {
      const editor = {
        state: {
          doc: { textContent: "no newline here" },
        },
      };
      mockGetEditor.mockReturnValue(editor);

      await handleDocumentSearch("req-lineend", { query: "here" });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data).toHaveLength(1);
      expect(call.data[0].text).toBe("no newline here");
    });
  });
});
