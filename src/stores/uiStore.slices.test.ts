import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

vi.mock("@/lib/formats/registry", () => ({
  listFormats: () => [
    { extensions: ["md"], adapters: { contentSearchIndexed: true } },
    { extensions: ["txt"], adapters: { contentSearchIndexed: true } },
    { extensions: ["png"], adapters: { contentSearchIndexed: false } },
  ],
}));

import { useUIStore, resetTerminalSessionStore } from "./uiStore";

function reset() {
  useUIStore.setState({
    search: {
      isOpen: false, query: "", replaceText: "",
      caseSensitive: false, wholeWord: false, useRegex: false, searchMarkdown: false,
      matchCount: 0, currentIndex: -1,
    },
    contentSearch: {
      isOpen: false, query: "", caseSensitive: false, wholeWord: false,
      useRegex: false, markdownOnly: true, results: [], selectedIndex: 0,
      isSearching: false, error: null, totalMatches: 0, totalFiles: 0,
    },
  });
  resetTerminalSessionStore();
  invokeMock.mockReset();
}

beforeEach(reset);

describe("search slice actions", () => {
  it("searchSetMatches updates count and index together", () => {
    useUIStore.getState().searchSetMatches(5, 2);
    expect(useUIStore.getState().search.matchCount).toBe(5);
    expect(useUIStore.getState().search.currentIndex).toBe(2);
  });

  it("searchFindNext is a no-op when matchCount is 0", () => {
    useUIStore.getState().searchFindNext();
    expect(useUIStore.getState().search.currentIndex).toBe(-1);
  });

  it("searchFindNext advances and wraps at the end", () => {
    useUIStore.getState().searchSetMatches(3, 0);
    useUIStore.getState().searchFindNext();
    expect(useUIStore.getState().search.currentIndex).toBe(1);
    useUIStore.getState().searchFindNext();
    expect(useUIStore.getState().search.currentIndex).toBe(2);
    useUIStore.getState().searchFindNext();
    expect(useUIStore.getState().search.currentIndex).toBe(0);
  });

  it("searchFindPrevious is a no-op when matchCount is 0", () => {
    useUIStore.getState().searchFindPrevious();
    expect(useUIStore.getState().search.currentIndex).toBe(-1);
  });

  it("searchFindPrevious decrements and wraps at the start", () => {
    useUIStore.getState().searchSetMatches(3, 0);
    useUIStore.getState().searchFindPrevious();
    expect(useUIStore.getState().search.currentIndex).toBe(2);
    useUIStore.getState().searchFindPrevious();
    expect(useUIStore.getState().search.currentIndex).toBe(1);
  });

  it("searchSetQuery resets currentIndex to -1", () => {
    useUIStore.getState().searchSetMatches(3, 2);
    useUIStore.getState().searchSetQuery("new");
    expect(useUIStore.getState().search.query).toBe("new");
    expect(useUIStore.getState().search.currentIndex).toBe(-1);
  });

  it("searchSetReplaceText updates only the replace field", () => {
    useUIStore.getState().searchSetReplaceText("xyz");
    expect(useUIStore.getState().search.replaceText).toBe("xyz");
  });

  it("searchToggleCaseSensitive / WholeWord / Regex / SearchMarkdown flip booleans", () => {
    const s = useUIStore.getState();
    s.searchToggleCaseSensitive();
    s.searchToggleWholeWord();
    s.searchToggleRegex();
    s.searchToggleSearchMarkdown();
    const after = useUIStore.getState().search;
    expect(after.caseSensitive).toBe(true);
    expect(after.wholeWord).toBe(true);
    expect(after.useRegex).toBe(true);
    expect(after.searchMarkdown).toBe(true);
  });

  it("searchToggle toggles isOpen", () => {
    useUIStore.getState().searchToggle();
    expect(useUIStore.getState().search.isOpen).toBe(true);
    useUIStore.getState().searchToggle();
    expect(useUIStore.getState().search.isOpen).toBe(false);
  });

  it("searchReplaceCurrent and searchReplaceAll dispatch CustomEvents", () => {
    const events: string[] = [];
    const listener = (e: Event) => events.push(e.type);
    window.addEventListener("search:replace-current", listener);
    window.addEventListener("search:replace-all", listener);
    useUIStore.getState().searchReplaceCurrent();
    useUIStore.getState().searchReplaceAll();
    expect(events).toEqual(["search:replace-current", "search:replace-all"]);
    window.removeEventListener("search:replace-current", listener);
    window.removeEventListener("search:replace-all", listener);
  });
});

describe("contentSearch slice actions", () => {
  it("contentSearchSetCaseSensitive / WholeWord / UseRegex / MarkdownOnly set values", () => {
    const s = useUIStore.getState();
    s.contentSearchSetCaseSensitive(true);
    s.contentSearchSetWholeWord(true);
    s.contentSearchSetUseRegex(true);
    s.contentSearchSetMarkdownOnly(false);
    const after = useUIStore.getState().contentSearch;
    expect(after.caseSensitive).toBe(true);
    expect(after.wholeWord).toBe(true);
    expect(after.useRegex).toBe(true);
    expect(after.markdownOnly).toBe(false);
  });

  it("contentSearchOpen resets selectedIndex and error", () => {
    useUIStore.setState((s) => ({
      contentSearch: { ...s.contentSearch, selectedIndex: 5, error: "old" },
    }));
    useUIStore.getState().contentSearchOpen();
    const cs = useUIStore.getState().contentSearch;
    expect(cs.isOpen).toBe(true);
    expect(cs.selectedIndex).toBe(0);
    expect(cs.error).toBeNull();
  });

  it("contentSearchClose flips isOpen and isSearching", () => {
    useUIStore.setState((s) => ({
      contentSearch: { ...s.contentSearch, isOpen: true, isSearching: true },
    }));
    useUIStore.getState().contentSearchClose();
    expect(useUIStore.getState().contentSearch.isOpen).toBe(false);
    expect(useUIStore.getState().contentSearch.isSearching).toBe(false);
  });

  it("contentSearchSelectNext and SelectPrev are no-ops when no results", () => {
    useUIStore.getState().contentSearchSelectNext();
    useUIStore.getState().contentSearchSelectPrev();
    expect(useUIStore.getState().contentSearch.selectedIndex).toBe(0);
  });

  it("contentSearchSelectNext / Prev wrap around match list", () => {
    const results = [
      {
        path: "/x.md", relativePath: "x.md",
        matches: [
          { lineNumber: 1, lineContent: "a", matchRanges: [{ start: 0, end: 1 }] },
          { lineNumber: 2, lineContent: "b", matchRanges: [{ start: 0, end: 1 }] },
        ],
      },
      {
        path: "/y.md", relativePath: "y.md",
        matches: [
          { lineNumber: 3, lineContent: "c", matchRanges: [{ start: 0, end: 1 }] },
        ],
      },
    ];
    useUIStore.setState((s) => ({
      contentSearch: { ...s.contentSearch, results, selectedIndex: 0 },
    }));
    useUIStore.getState().contentSearchSelectNext();
    expect(useUIStore.getState().contentSearch.selectedIndex).toBe(1);
    useUIStore.getState().contentSearchSelectNext();
    expect(useUIStore.getState().contentSearch.selectedIndex).toBe(2);
    useUIStore.getState().contentSearchSelectNext();
    expect(useUIStore.getState().contentSearch.selectedIndex).toBe(0);
    useUIStore.getState().contentSearchSelectPrev();
    expect(useUIStore.getState().contentSearch.selectedIndex).toBe(2);
  });

  it("contentSearchClearResults zeroes counters and clears the list", () => {
    useUIStore.setState((s) => ({
      contentSearch: {
        ...s.contentSearch,
        results: [{ path: "/a", relativePath: "a", matches: [] }],
        totalMatches: 3,
        totalFiles: 1,
        selectedIndex: 2,
        error: "x",
      },
    }));
    useUIStore.getState().contentSearchClearResults();
    const cs = useUIStore.getState().contentSearch;
    expect(cs.results).toEqual([]);
    expect(cs.totalMatches).toBe(0);
    expect(cs.totalFiles).toBe(0);
    expect(cs.selectedIndex).toBe(0);
    expect(cs.error).toBeNull();
  });

  it("contentSearchRun short-circuits when query is shorter than 3 chars", async () => {
    useUIStore.setState((s) => ({
      contentSearch: { ...s.contentSearch, query: "ab" },
    }));
    await useUIStore.getState().contentSearchRun("/root", []);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(useUIStore.getState().contentSearch.results).toEqual([]);
  });

  it("contentSearchRun invokes search_workspace_content and stores results", async () => {
    const stubResults = [
      {
        path: "/r/a.md", relativePath: "a.md",
        matches: [
          { lineNumber: 1, lineContent: "abc", matchRanges: [{ start: 0, end: 3 }, { start: 4, end: 7 }] },
        ],
      },
    ];
    invokeMock.mockResolvedValueOnce(stubResults);
    useUIStore.setState((s) => ({
      contentSearch: { ...s.contentSearch, query: "abc" },
    }));
    await useUIStore.getState().contentSearchRun("/root", ["node_modules"]);
    expect(invokeMock).toHaveBeenCalledWith("search_workspace_content", expect.objectContaining({
      rootPath: "/root",
      query: "abc",
      excludeFolders: ["node_modules"],
    }));
    const cs = useUIStore.getState().contentSearch;
    expect(cs.totalFiles).toBe(1);
    expect(cs.totalMatches).toBe(2);
    expect(cs.isSearching).toBe(false);
  });

  it("contentSearchRun records error message on invoke failure", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend down"));
    useUIStore.setState((s) => ({
      contentSearch: { ...s.contentSearch, query: "abc" },
    }));
    await useUIStore.getState().contentSearchRun("/root", []);
    expect(useUIStore.getState().contentSearch.error).toBe("backend down");
    expect(useUIStore.getState().contentSearch.isSearching).toBe(false);
  });
});

describe("terminal slice actions", () => {
  it("terminalCreateSession adds a session and marks it active", () => {
    const session = useUIStore.getState().terminalCreateSession();
    expect(session).not.toBeNull();
    const t = useUIStore.getState().terminal;
    expect(t.sessions).toHaveLength(1);
    expect(t.activeSessionId).toBe(session!.id);
    expect(session!.isAlive).toBe(true);
  });

  it("terminalRemoveSession picks the last remaining session as active", () => {
    const a = useUIStore.getState().terminalCreateSession()!;
    const b = useUIStore.getState().terminalCreateSession()!;
    useUIStore.getState().terminalRemoveSession(b.id);
    expect(useUIStore.getState().terminal.activeSessionId).toBe(a.id);
  });

  it("terminalRemoveSession sets active to null when no sessions remain", () => {
    const a = useUIStore.getState().terminalCreateSession()!;
    useUIStore.getState().terminalRemoveSession(a.id);
    expect(useUIStore.getState().terminal.activeSessionId).toBeNull();
  });

  it("terminalRemoveSession leaves active untouched when removing a non-active session", () => {
    const a = useUIStore.getState().terminalCreateSession()!;
    const b = useUIStore.getState().terminalCreateSession()!;
    useUIStore.getState().terminalRemoveSession(a.id);
    expect(useUIStore.getState().terminal.activeSessionId).toBe(b.id);
  });

  it("terminalSetActiveSession switches to an existing session only", () => {
    const a = useUIStore.getState().terminalCreateSession()!;
    const b = useUIStore.getState().terminalCreateSession()!;
    useUIStore.getState().terminalSetActiveSession(a.id);
    expect(useUIStore.getState().terminal.activeSessionId).toBe(a.id);
    useUIStore.getState().terminalSetActiveSession("does-not-exist");
    expect(useUIStore.getState().terminal.activeSessionId).toBe(a.id);
    expect(b.id).toBeTruthy();
  });

  it("terminalMarkSessionDead / Alive flip the isAlive flag", () => {
    const s = useUIStore.getState().terminalCreateSession()!;
    useUIStore.getState().terminalMarkSessionDead(s.id);
    expect(useUIStore.getState().terminal.sessions[0].isAlive).toBe(false);
    useUIStore.getState().terminalMarkSessionAlive(s.id);
    expect(useUIStore.getState().terminal.sessions[0].isAlive).toBe(true);
  });

  it("terminalRenameSession updates the label", () => {
    const s = useUIStore.getState().terminalCreateSession()!;
    useUIStore.getState().terminalRenameSession(s.id, "renamed");
    expect(useUIStore.getState().terminal.sessions[0].label).toBe("renamed");
  });
});
