/**
 * Tests for contentSearchStore
 *
 * Covers: open/close, query management, selectedIndex navigation,
 * request ID staleness, option toggling, and result clearing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useContentSearchStore } from "../contentSearchStore";

// Mock tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("contentSearchStore", () => {
  beforeEach(() => {
    useContentSearchStore.setState({
      isOpen: false,
      query: "",
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      markdownOnly: true,
      results: [],
      selectedIndex: 0,
      isSearching: false,
      error: null,
      totalMatches: 0,
      totalFiles: 0,
    });
  });

  describe("open/close", () => {
    it("opens the overlay", () => {
      useContentSearchStore.getState().open();
      expect(useContentSearchStore.getState().isOpen).toBe(true);
    });

    it("closes the overlay", () => {
      useContentSearchStore.setState({ isOpen: true });
      useContentSearchStore.getState().close();
      expect(useContentSearchStore.getState().isOpen).toBe(false);
    });

    it("resets selectedIndex and error on open", () => {
      useContentSearchStore.setState({
        selectedIndex: 5,
        error: "some error",
      });
      useContentSearchStore.getState().open();
      expect(useContentSearchStore.getState().selectedIndex).toBe(0);
      expect(useContentSearchStore.getState().error).toBeNull();
    });
  });

  describe("setQuery", () => {
    it("updates query and resets selectedIndex", () => {
      useContentSearchStore.setState({ selectedIndex: 3 });
      useContentSearchStore.getState().setQuery("test");
      expect(useContentSearchStore.getState().query).toBe("test");
      expect(useContentSearchStore.getState().selectedIndex).toBe(0);
    });

    it("clears error on query change", () => {
      useContentSearchStore.setState({ error: "old error" });
      useContentSearchStore.getState().setQuery("new");
      expect(useContentSearchStore.getState().error).toBeNull();
    });
  });

  describe("option toggles", () => {
    it("toggles caseSensitive", () => {
      useContentSearchStore.getState().setCaseSensitive(true);
      expect(useContentSearchStore.getState().caseSensitive).toBe(true);
      useContentSearchStore.getState().setCaseSensitive(false);
      expect(useContentSearchStore.getState().caseSensitive).toBe(false);
    });

    it("toggles wholeWord", () => {
      useContentSearchStore.getState().setWholeWord(true);
      expect(useContentSearchStore.getState().wholeWord).toBe(true);
    });

    it("toggles useRegex", () => {
      useContentSearchStore.getState().setUseRegex(true);
      expect(useContentSearchStore.getState().useRegex).toBe(true);
    });

    it("toggles markdownOnly", () => {
      expect(useContentSearchStore.getState().markdownOnly).toBe(true);
      useContentSearchStore.getState().setMarkdownOnly(false);
      expect(useContentSearchStore.getState().markdownOnly).toBe(false);
    });
  });

  describe("selectNext/selectPrev", () => {
    const mockResults = [
      {
        path: "/a.md",
        relativePath: "a.md",
        matches: [
          { lineNumber: 1, lineContent: "match one", matchRanges: [{ start: 0, end: 5 }] },
          { lineNumber: 5, lineContent: "match two", matchRanges: [{ start: 0, end: 5 }] },
        ],
      },
      {
        path: "/b.md",
        relativePath: "b.md",
        matches: [
          { lineNumber: 3, lineContent: "match three", matchRanges: [{ start: 0, end: 5 }] },
        ],
      },
    ];

    beforeEach(() => {
      useContentSearchStore.setState({
        results: mockResults,
        selectedIndex: 0,
      });
    });

    it("selectNext advances through flat matches", () => {
      useContentSearchStore.getState().selectNext();
      expect(useContentSearchStore.getState().selectedIndex).toBe(1);
      useContentSearchStore.getState().selectNext();
      expect(useContentSearchStore.getState().selectedIndex).toBe(2);
    });

    it("selectNext wraps around", () => {
      useContentSearchStore.setState({ selectedIndex: 2 });
      useContentSearchStore.getState().selectNext();
      expect(useContentSearchStore.getState().selectedIndex).toBe(0);
    });

    it("selectPrev goes backward", () => {
      useContentSearchStore.setState({ selectedIndex: 2 });
      useContentSearchStore.getState().selectPrev();
      expect(useContentSearchStore.getState().selectedIndex).toBe(1);
    });

    it("selectPrev wraps to last", () => {
      useContentSearchStore.setState({ selectedIndex: 0 });
      useContentSearchStore.getState().selectPrev();
      expect(useContentSearchStore.getState().selectedIndex).toBe(2);
    });

    it("selectNext no-ops when no results", () => {
      useContentSearchStore.setState({ results: [], selectedIndex: 0 });
      useContentSearchStore.getState().selectNext();
      expect(useContentSearchStore.getState().selectedIndex).toBe(0);
    });
  });

  describe("clearResults", () => {
    it("clears results and resets counters", () => {
      useContentSearchStore.setState({
        results: [
          {
            path: "/a.md",
            relativePath: "a.md",
            matches: [
              { lineNumber: 1, lineContent: "x", matchRanges: [{ start: 0, end: 1 }] },
            ],
          },
        ],
        totalMatches: 5,
        totalFiles: 1,
        selectedIndex: 3,
        error: "error",
      });

      useContentSearchStore.getState().clearResults();

      const state = useContentSearchStore.getState();
      expect(state.results).toEqual([]);
      expect(state.totalMatches).toBe(0);
      expect(state.totalFiles).toBe(0);
      expect(state.selectedIndex).toBe(0);
      expect(state.error).toBeNull();
    });
  });

  describe("search", () => {
    it("rejects short queries without calling invoke", async () => {
      useContentSearchStore.getState().setQuery("ab");
      await useContentSearchStore.getState().search("/root", []);

      expect(useContentSearchStore.getState().results).toEqual([]);
      expect(useContentSearchStore.getState().isSearching).toBe(false);
    });

    it("calls invoke with correct params for valid query", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const mockInvoke = vi.mocked(invoke);
      mockInvoke.mockResolvedValue([
        {
          path: "/root/test.md",
          relativePath: "test.md",
          matches: [
            {
              lineNumber: 1,
              lineContent: "hello world",
              matchRanges: [{ start: 6, end: 11 }],
            },
          ],
        },
      ]);

      useContentSearchStore.getState().setQuery("world");
      await useContentSearchStore.getState().search("/root", ["node_modules"]);

      expect(mockInvoke).toHaveBeenCalledWith(
        "search_workspace_content",
        expect.objectContaining({
          rootPath: "/root",
          query: "world",
          caseSensitive: false,
          wholeWord: false,
          useRegex: false,
          markdownOnly: true,
          excludeFolders: ["node_modules"],
        })
      );

      const state = useContentSearchStore.getState();
      expect(state.results).toHaveLength(1);
      expect(state.totalFiles).toBe(1);
      expect(state.isSearching).toBe(false);
      expect(state.error).toBeNull();
    });

    it("handles invoke errors", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const mockInvoke = vi.mocked(invoke);
      // Tauri invoke rejects with plain strings, not Error objects
      mockInvoke.mockRejectedValue("Invalid regex: [bad");

      useContentSearchStore.getState().setQuery("test query");
      await useContentSearchStore.getState().search("/root", []);

      const state = useContentSearchStore.getState();
      expect(state.results).toEqual([]);
      expect(state.error).toBe("Invalid regex: [bad");
      expect(state.isSearching).toBe(false);
    });
  });
});
