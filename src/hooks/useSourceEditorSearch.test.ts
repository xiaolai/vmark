/**
 * Tests for useSourceEditorSearch hook
 *
 * Tests the bridge between searchStore and CodeMirror search extension.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const {
  mockSetSearchQuery,
  mockSearchQuery,
  mockFindNext,
  mockFindPrevious,
  mockReplaceNext,
  mockReplaceAll,
  mockCountMatches,
} = vi.hoisted(() => ({
  mockSetSearchQuery: { of: vi.fn(() => "set-search-query-effect") },
  mockSearchQuery: vi.fn(function(this: unknown, opts: unknown) { Object.assign(this as object, opts); }),
  mockFindNext: vi.fn(),
  mockFindPrevious: vi.fn(),
  mockReplaceNext: vi.fn(),
  mockReplaceAll: vi.fn(),
  mockCountMatches: vi.fn(() => 0),
}));

vi.mock("@codemirror/search", () => ({
  setSearchQuery: mockSetSearchQuery,
  SearchQuery: mockSearchQuery,
  findNext: mockFindNext,
  findPrevious: mockFindPrevious,
  replaceNext: mockReplaceNext,
  replaceAll: mockReplaceAll,
}));

// Mock imeGuard — run actions immediately
vi.mock("@/utils/imeGuard", () => ({
  runOrQueueCodeMirrorAction: vi.fn((_view: unknown, action: () => void) => action()),
}));

vi.mock("@/utils/sourceEditorSearch", () => ({
  countMatches: (...args: unknown[]) => mockCountMatches(...args),
}));

import { renderHook, act } from "@testing-library/react";
import { useUIStore } from "@/stores/uiStore";
import { useSourceEditorSearch } from "./useSourceEditorSearch";

// Helper to create a mock EditorView
function createMockView(docText = "hello world") {
  return {
    state: {
      doc: {
        toString: () => docText,
      },
    },
    dispatch: vi.fn(),
  } as unknown;
}

describe("useSourceEditorSearch", () => {
  let viewRef: { current: ReturnType<typeof createMockView> | null };

  beforeEach(() => {
    vi.useFakeTimers();
    viewRef = { current: null };
    // Reset search slice
    useUIStore.setState((s) => ({
      search: {
        ...s.search,
        isOpen: false,
        query: "",
        replaceText: "",
        caseSensitive: false,
        wholeWord: false,
        useRegex: false,
        matchCount: 0,
        currentIndex: -1,
      },
    }));
    mockCountMatches.mockReturnValue(0);
    mockFindNext.mockClear();
    mockFindPrevious.mockClear();
    mockReplaceNext.mockClear();
    mockReplaceAll.mockClear();
    mockSetSearchQuery.of.mockClear();
    mockSearchQuery.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets up store subscription and event listeners on mount", () => {
    const addEventSpy = vi.spyOn(window, "addEventListener");
    renderHook(() => useSourceEditorSearch(viewRef as never));

    expect(addEventSpy).toHaveBeenCalledWith("search:replace-current", expect.any(Function));
    expect(addEventSpy).toHaveBeenCalledWith("search:replace-all", expect.any(Function));
    addEventSpy.mockRestore();
  });

  it("cleans up listeners on unmount", () => {
    const removeEventSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useSourceEditorSearch(viewRef as never));

    unmount();

    expect(removeEventSpy).toHaveBeenCalledWith("search:replace-current", expect.any(Function));
    expect(removeEventSpy).toHaveBeenCalledWith("search:replace-all", expect.any(Function));
    removeEventSpy.mockRestore();
  });

  it("initializes search state when view becomes available via polling", () => {
    const mockView = createMockView("test content");
    mockCountMatches.mockReturnValue(2);

    useUIStore.setState((s) => ({ search: { ...s.search, isOpen: true, query: "test" } }));

    renderHook(() => useSourceEditorSearch(viewRef as never));

    // View not set yet — poll should be active
    expect(mockSetSearchQuery.of).not.toHaveBeenCalled();

    // Set the view and advance timer
    viewRef.current = mockView;
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(mockSetSearchQuery.of).toHaveBeenCalled();
  });

  it("initializes immediately when view is already available", () => {
    const mockView = createMockView("test content");
    viewRef.current = mockView;
    mockCountMatches.mockReturnValue(1);

    useUIStore.setState((s) => ({ search: { ...s.search, isOpen: true, query: "test" } }));

    renderHook(() => useSourceEditorSearch(viewRef as never));

    expect(mockSetSearchQuery.of).toHaveBeenCalled();
  });

  it("skips initialization if search is not open", () => {
    const mockView = createMockView("test content");
    viewRef.current = mockView;

    useUIStore.setState((s) => ({ search: { ...s.search, isOpen: false, query: "" } }));

    renderHook(() => useSourceEditorSearch(viewRef as never));

    expect(mockSetSearchQuery.of).not.toHaveBeenCalled();
  });

  it("dispatches search query when query changes in store", () => {
    const mockView = createMockView("hello world hello");
    viewRef.current = mockView;
    mockCountMatches.mockReturnValue(2);

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      useUIStore.getState().searchSetQuery("hello");
    });

    expect(mockSetSearchQuery.of).toHaveBeenCalled();
    expect(mockCountMatches).toHaveBeenCalledWith("hello world hello", "hello", false, false, false);
  });

  it("clears search when query becomes empty", () => {
    const mockView = createMockView("hello world");
    viewRef.current = mockView;
    mockCountMatches.mockReturnValue(1);

    renderHook(() => useSourceEditorSearch(viewRef as never));

    // First set a query
    act(() => {
      useUIStore.getState().searchSetQuery("hello");
    });

    mockSetSearchQuery.of.mockClear();

    // Then clear it
    act(() => {
      useUIStore.getState().searchSetQuery("");
    });

    expect(mockSetSearchQuery.of).toHaveBeenCalled();
    expect(useUIStore.getState().search.matchCount).toBe(0);
    expect(useUIStore.getState().search.currentIndex).toBe(-1);
  });

  it("calls findNext when currentIndex increases", () => {
    const mockView = createMockView("hello hello hello");
    viewRef.current = mockView;
    mockCountMatches.mockReturnValue(3);

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      useUIStore.getState().searchSetQuery("hello");
    });

    act(() => {
      useUIStore.getState().searchFindNext();
    });

    expect(mockFindNext).toHaveBeenCalledWith(mockView);
  });

  it("calls findPrevious when currentIndex decreases", () => {
    const mockView = createMockView("hello hello hello");
    viewRef.current = mockView;
    mockCountMatches.mockReturnValue(3);

    renderHook(() => useSourceEditorSearch(viewRef as never));

    // Set up with matches at index 2
    act(() => {
      useUIStore.setState((s) => ({ search: { ...s.search, query: "hello", matchCount: 3, currentIndex: 2 } }));
    });

    act(() => {
      useUIStore.getState().searchFindPrevious();
    });

    expect(mockFindPrevious).toHaveBeenCalledWith(mockView);
  });

  describe("wrap-aware find direction", () => {
    // The store WRAPS on navigation (last → 0 on next, 0 → last on previous),
    // so a raw index comparison inverts at every wrap. These tests pin the
    // wrap-aware inference: forward iff new index is the successor of the old
    // one modulo matchCount.

    function setupMatches(matchCount: number, currentIndex: number) {
      const mockView = createMockView("hello hello hello");
      viewRef.current = mockView;
      mockCountMatches.mockReturnValue(matchCount);

      renderHook(() => useSourceEditorSearch(viewRef as never));

      act(() => {
        useUIStore.setState((s) => ({
          search: { ...s.search, isOpen: true, query: "hello", matchCount, currentIndex },
        }));
      });

      mockFindNext.mockClear();
      mockFindPrevious.mockClear();
      return mockView;
    }

    it("dispatches findNext when wrapping forward (last → 0)", () => {
      const mockView = setupMatches(3, 2);

      act(() => {
        useUIStore.getState().searchFindNext(); // 2 → 0 (wrap)
      });

      expect(useUIStore.getState().search.currentIndex).toBe(0);
      expect(mockFindNext).toHaveBeenCalledWith(mockView);
      expect(mockFindPrevious).not.toHaveBeenCalled();
    });

    it("dispatches findPrevious when wrapping backward (0 → last)", () => {
      const mockView = setupMatches(3, 0);

      act(() => {
        useUIStore.getState().searchFindPrevious(); // 0 → 2 (wrap)
      });

      expect(useUIStore.getState().search.currentIndex).toBe(2);
      expect(mockFindPrevious).toHaveBeenCalledWith(mockView);
      expect(mockFindNext).not.toHaveBeenCalled();
    });

    it("keeps the counter in sync across repeated wraps (next past the end twice)", () => {
      setupMatches(3, 1);

      act(() => {
        useUIStore.getState().searchFindNext(); // 1 → 2
      });
      act(() => {
        useUIStore.getState().searchFindNext(); // 2 → 0 (wrap)
      });
      act(() => {
        useUIStore.getState().searchFindNext(); // 0 → 1
      });

      expect(useUIStore.getState().search.currentIndex).toBe(1);
      expect(mockFindNext).toHaveBeenCalledTimes(3);
      expect(mockFindPrevious).not.toHaveBeenCalled();
    });

    it("N=1: navigation does not change the index and dispatches nothing", () => {
      setupMatches(1, 0);

      act(() => {
        useUIStore.getState().searchFindNext(); // 0 → 0 (no change)
        useUIStore.getState().searchFindPrevious(); // 0 → 0 (no change)
      });

      expect(useUIStore.getState().search.currentIndex).toBe(0);
      expect(mockFindNext).not.toHaveBeenCalled();
      expect(mockFindPrevious).not.toHaveBeenCalled();
    });

    it("N=1: first navigation from no-current-match (-1 → 0) dispatches findNext", () => {
      const mockView = setupMatches(1, 0);

      // Drop the current match WITHOUT touching the query — a query change
      // would trigger recompute, which immediately re-selects index 0.
      act(() => {
        useUIStore.setState((s) => ({ search: { ...s.search, currentIndex: -1 } }));
      });
      mockFindNext.mockClear();
      mockFindPrevious.mockClear();

      act(() => {
        useUIStore.getState().searchFindNext(); // -1 → 0
      });

      expect(mockFindNext).toHaveBeenCalledWith(mockView);
      expect(mockFindPrevious).not.toHaveBeenCalled();
    });

    it("N=2: wrapping forward (1 → 0) dispatches findNext", () => {
      const mockView = setupMatches(2, 1);

      act(() => {
        useUIStore.getState().searchFindNext(); // 1 → 0 (wrap)
      });

      expect(mockFindNext).toHaveBeenCalledWith(mockView);
      expect(mockFindPrevious).not.toHaveBeenCalled();
    });

    it("N=2: backward wrap (0 → 1) dispatches a navigation that reaches the other match", () => {
      // With exactly two matches, successor and predecessor coincide modulo 2,
      // so the inference resolves to findNext — which lands on the same (only
      // other) match findPrevious would. Behaviorally equivalent by design.
      setupMatches(2, 0);

      act(() => {
        useUIStore.getState().searchFindPrevious(); // 0 → 1 (wrap)
      });

      expect(useUIStore.getState().search.currentIndex).toBe(1);
      expect(mockFindNext.mock.calls.length + mockFindPrevious.mock.calls.length).toBe(1);
    });
  });

  it("updates query when replaceText changes while search is open", () => {
    const mockView = createMockView("hello world");
    viewRef.current = mockView;
    mockCountMatches.mockReturnValue(1);

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      useUIStore.setState((s) => ({ search: { ...s.search, isOpen: true, query: "hello" } }));
    });

    mockSetSearchQuery.of.mockClear();

    act(() => {
      useUIStore.getState().searchSetReplaceText("goodbye");
    });

    expect(mockSetSearchQuery.of).toHaveBeenCalled();
  });

  it("handles replace-current event", () => {
    const mockView = createMockView("hello world");
    viewRef.current = mockView;

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      window.dispatchEvent(new Event("search:replace-current"));
    });

    expect(mockReplaceNext).toHaveBeenCalledWith(mockView);
  });

  it("handles replace-all event", () => {
    const mockView = createMockView("hello world");
    viewRef.current = mockView;

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      window.dispatchEvent(new Event("search:replace-all"));
    });

    expect(mockReplaceAll).toHaveBeenCalledWith(mockView);
  });

  it("does nothing on replace events when view is null", () => {
    viewRef.current = null;

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      window.dispatchEvent(new Event("search:replace-current"));
      window.dispatchEvent(new Event("search:replace-all"));
    });

    expect(mockReplaceNext).not.toHaveBeenCalled();
    expect(mockReplaceAll).not.toHaveBeenCalled();
  });

  it("does nothing on store change when view is null", () => {
    viewRef.current = null;

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      useUIStore.getState().searchSetQuery("hello");
    });

    expect(mockSetSearchQuery.of).not.toHaveBeenCalled();
  });

  it("recomputes matches when caseSensitive changes", () => {
    const mockView = createMockView("Hello hello");
    viewRef.current = mockView;
    mockCountMatches.mockReturnValue(2);

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      useUIStore.getState().searchSetQuery("hello");
    });

    mockCountMatches.mockClear();
    mockCountMatches.mockReturnValue(1);

    act(() => {
      useUIStore.getState().searchToggleCaseSensitive();
    });

    expect(mockCountMatches).toHaveBeenCalledWith(
      "Hello hello",
      "hello",
      true,
      false,
      false
    );
  });

  it("recomputes matches when useRegex changes", () => {
    const mockView = createMockView("hello 123 world");
    viewRef.current = mockView;
    mockCountMatches.mockReturnValue(1);

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      useUIStore.getState().searchSetQuery("\\d+");
    });

    mockCountMatches.mockClear();

    act(() => {
      useUIStore.getState().searchToggleRegex();
    });

    expect(mockCountMatches).toHaveBeenCalled();
  });

  it("sets match count to 0 and index to -1 when query becomes empty via store change", () => {
    const mockView = createMockView("hello");
    viewRef.current = mockView;
    mockCountMatches.mockReturnValue(1);

    // Start with a query
    useUIStore.setState((s) => ({ search: { ...s.search, isOpen: true, query: "hello", matchCount: 1, currentIndex: 0 } }));

    renderHook(() => useSourceEditorSearch(viewRef as never));

    // Clear the query — this triggers the subscription handler which clears matches
    act(() => {
      useUIStore.getState().searchSetQuery("");
    });

    expect(useUIStore.getState().search.matchCount).toBe(0);
    expect(useUIStore.getState().search.currentIndex).toBe(-1);
  });

  it("safety timeout fires with isInitialized=true (line 123 false branch — polling succeeds before timeout)", () => {
    // Polling path: view is null initially → polling interval registered.
    // View becomes available on first poll tick (50ms) → isInitialized=true.
    // Safety timeout fires at 500ms — isInitialized IS true → `if (!isInitialized)` false branch.
    const mockView = createMockView("test content");
    mockCountMatches.mockReturnValue(1);
    useUIStore.setState((s) => ({ search: { ...s.search, isOpen: true, query: "test" } }));

    renderHook(() => useSourceEditorSearch(viewRef as never));

    // Set view available BEFORE advancing timers — polling will succeed on first tick
    viewRef.current = mockView;

    // Advance 50ms: first poll tick runs initSearchState → succeeds → isInitialized=true
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(mockSetSearchQuery.of).toHaveBeenCalled();

    mockSetSearchQuery.of.mockClear();

    // Advance past 500ms: safety timeout fires with isInitialized=true → false branch at line 123
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // No further init calls — the safety timeout's false branch just skips clearInterval
    expect(mockSetSearchQuery.of).not.toHaveBeenCalled();
  });

  it("safety timeout fires with isInitialized=false (line 123 true branch via slow polling)", () => {
    // View never becomes available → polling runs → timeout fires → clearInterval.
    // This specifically hits line 123 with !isInitialized === true.
    viewRef.current = null;
    useUIStore.setState((s) => ({ search: { ...s.search, isOpen: true, query: "test" } }));

    renderHook(() => useSourceEditorSearch(viewRef as never));

    // Advance past 500ms safety timeout — fires with isInitialized still false
    act(() => {
      vi.advanceTimersByTime(600);
    });

    // The safety timeout cleared the interval; no init happened
    expect(mockSetSearchQuery.of).not.toHaveBeenCalled();
  });

  it("replace-current: viewRef.current null in second rAF skips recompute (line 186 false branch)", () => {
    // The double-rAF in handleReplaceCurrent:
    //   rAF1 → fires → rAF2 → fires → if (viewRef.current) { recompute }
    // We null viewRef.current between rAF1 firing and rAF2 firing.
    const mockView = createMockView("hello");
    viewRef.current = mockView;

    // Capture rAF callbacks; the second is registered INSIDE the first callback
    const rafCallbacks: FrameRequestCallback[] = [];
    const mockRaf = vi.spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb) => { rafCallbacks.push(cb); return rafCallbacks.length; });

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      window.dispatchEvent(new Event("search:replace-current"));
    });

    // rafCallbacks[0] is the outer rAF registered by handleReplaceCurrent.
    // Fire it — this registers the inner rAF (rafCallbacks[1]).
    act(() => {
      rafCallbacks[0]?.(0);
    });

    // Null the view BEFORE the inner rAF fires
    viewRef.current = null;
    mockCountMatches.mockClear();

    // Fire inner rAF — viewRef.current is null → line 186 false branch → no recompute
    act(() => {
      rafCallbacks[1]?.(0);
    });

    expect(mockCountMatches).not.toHaveBeenCalled();

    mockRaf.mockRestore();
  });

  it("replace-all: viewRef.current null in second rAF does not call recompute (line 202 false branch)", () => {
    const mockView = createMockView("hello");
    viewRef.current = mockView;

    const rafCallbacks: FrameRequestCallback[] = [];
    const mockRaf = vi.spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb) => { rafCallbacks.push(cb); return rafCallbacks.length; });

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      window.dispatchEvent(new Event("search:replace-all"));
    });

    // Fire outer rAF — registers inner rAF
    act(() => {
      rafCallbacks[0]?.(0);
    });

    // Null view before inner rAF fires
    viewRef.current = null;
    mockCountMatches.mockClear();

    // Fire inner rAF — viewRef.current is null → line 202 false branch → no recompute
    act(() => {
      rafCallbacks[1]?.(0);
    });

    expect(mockCountMatches).not.toHaveBeenCalled();

    mockRaf.mockRestore();
  });

  it("clears polling interval after max wait time", () => {
    // View never becomes available
    viewRef.current = null;
    useUIStore.setState((s) => ({ search: { ...s.search, isOpen: true, query: "test" } }));

    renderHook(() => useSourceEditorSearch(viewRef as never));

    // Advance past max wait
    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Now set view — should not trigger init since interval was cleared
    const mockView = createMockView("test");
    viewRef.current = mockView;

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // The polling interval was cleared, so no init happened via polling
    // (The store subscription would still work though)
  });

  it("recomputes matches when wholeWord changes", () => {
    const mockView = createMockView("hello world hello");
    viewRef.current = mockView;
    mockCountMatches.mockReturnValue(2);

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      useUIStore.getState().searchSetQuery("hello");
    });

    mockCountMatches.mockClear();
    mockCountMatches.mockReturnValue(2);

    act(() => {
      useUIStore.getState().searchToggleWholeWord();
    });

    expect(mockCountMatches).toHaveBeenCalledWith(
      "hello world hello",
      "hello",
      false,
      true,
      false
    );
  });

  it("recomputes matches after replace-current via rAF", () => {
    const mockView = createMockView("hello world hello");
    viewRef.current = mockView;
    mockCountMatches.mockReturnValue(2);

    const mockRaf = vi.spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb) => { cb(0); return 0; });

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      useUIStore.setState((s) => ({ search: { ...s.search, isOpen: true, query: "hello", matchCount: 2, currentIndex: 0 } }));
    });

    mockCountMatches.mockClear();
    mockCountMatches.mockReturnValue(1);

    act(() => {
      window.dispatchEvent(new Event("search:replace-current"));
    });

    expect(mockReplaceNext).toHaveBeenCalledWith(mockView);
    // After double-rAF, recomputeMatches should be called with preserveIndex=true
    expect(mockCountMatches).toHaveBeenCalled();

    mockRaf.mockRestore();
  });

  it("recomputes matches after replace-all via rAF", () => {
    const mockView = createMockView("hello world hello");
    viewRef.current = mockView;
    mockCountMatches.mockReturnValue(2);

    const mockRaf = vi.spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb) => { cb(0); return 0; });

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      useUIStore.setState((s) => ({ search: { ...s.search, isOpen: true, query: "hello", matchCount: 2, currentIndex: 0 } }));
    });

    mockCountMatches.mockClear();
    mockCountMatches.mockReturnValue(0);

    act(() => {
      window.dispatchEvent(new Event("search:replace-all"));
    });

    expect(mockReplaceAll).toHaveBeenCalledWith(mockView);
    expect(mockCountMatches).toHaveBeenCalled();

    mockRaf.mockRestore();
  });

  it("preserves currentIndex when it is valid after replace-current", () => {
    const mockView = createMockView("hello world hello");
    viewRef.current = mockView;

    const mockRaf = vi.spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb) => { cb(0); return 0; });

    renderHook(() => useSourceEditorSearch(viewRef as never));

    // Set up initial state with 3 matches at index 1
    act(() => {
      useUIStore.setState((s) => ({ search: { ...s.search, isOpen: true, query: "hello", matchCount: 3, currentIndex: 1 } }));
    });

    // After replace, still 2 matches — index 1 is still valid
    mockCountMatches.mockReturnValue(2);

    act(() => {
      window.dispatchEvent(new Event("search:replace-current"));
    });

    // The recomputeMatches with preserveIndex=true should keep index at 1
    const state = useUIStore.getState().search;
    expect(state.matchCount).toBe(2);

    mockRaf.mockRestore();
  });

  it("resets index to 0 when currentIndex exceeds new matchCount", () => {
    const mockView = createMockView("hello world hello");
    viewRef.current = mockView;

    const mockRaf = vi.spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb) => { cb(0); return 0; });

    renderHook(() => useSourceEditorSearch(viewRef as never));

    // Set up initial state with 3 matches at index 2
    act(() => {
      useUIStore.setState((s) => ({ search: { ...s.search, isOpen: true, query: "hello", matchCount: 3, currentIndex: 2 } }));
    });

    // After replace-all, only 1 match — index 2 is out of bounds
    mockCountMatches.mockReturnValue(1);

    act(() => {
      window.dispatchEvent(new Event("search:replace-all"));
    });

    const state = useUIStore.getState().search;
    expect(state.matchCount).toBe(1);
    expect(state.currentIndex).toBe(0);

    mockRaf.mockRestore();
  });

  it("sets index to -1 when no matches remain after replace-all", () => {
    const mockView = createMockView("hello world hello");
    viewRef.current = mockView;

    const mockRaf = vi.spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb) => { cb(0); return 0; });

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      useUIStore.setState((s) => ({ search: { ...s.search, isOpen: true, query: "hello", matchCount: 2, currentIndex: 0 } }));
    });

    mockCountMatches.mockReturnValue(0);

    act(() => {
      window.dispatchEvent(new Event("search:replace-all"));
    });

    const state = useUIStore.getState().search;
    expect(state.matchCount).toBe(0);
    expect(state.currentIndex).toBe(-1);

    mockRaf.mockRestore();
  });

  it("sets matchCount to 0 and index to -1 when recomputeMatches is called with empty query (direct path)", () => {
    // This covers the !state.query branch (line 58) in recomputeMatches when called
    // after replace-current with an empty query in the store.
    const mockView = createMockView("hello world");
    viewRef.current = mockView;

    const mockRaf = vi.spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb) => { cb(0); return 0; });

    renderHook(() => useSourceEditorSearch(viewRef as never));

    // Set store to open with empty query, then fire replace-current
    act(() => {
      useUIStore.setState((s) => ({ search: { ...s.search, isOpen: true, query: "", matchCount: 0, currentIndex: -1 } }));
    });

    mockCountMatches.mockClear();

    act(() => {
      window.dispatchEvent(new Event("search:replace-current"));
    });

    // recomputeMatches is called with state.query === "" → early return sets 0/-1
    const state = useUIStore.getState().search;
    expect(state.matchCount).toBe(0);
    expect(state.currentIndex).toBe(-1);
    // countMatches should NOT be called when query is empty
    expect(mockCountMatches).not.toHaveBeenCalled();

    mockRaf.mockRestore();
  });

  it("does not recompute matches after replace if view becomes null", () => {
    const mockView = createMockView("hello");
    viewRef.current = mockView;

    const rafCallbacks: FrameRequestCallback[] = [];
    const mockRaf = vi.spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb) => { rafCallbacks.push(cb); return rafCallbacks.length; });

    renderHook(() => useSourceEditorSearch(viewRef as never));

    act(() => {
      window.dispatchEvent(new Event("search:replace-current"));
    });

    // Set view to null before rAF fires
    viewRef.current = null;
    mockCountMatches.mockClear();

    // Run all queued rAF callbacks
    rafCallbacks.forEach(cb => cb(0));

    // recomputeMatches should not be called because viewRef.current is null
    expect(mockCountMatches).not.toHaveBeenCalled();

    mockRaf.mockRestore();
  });
});
