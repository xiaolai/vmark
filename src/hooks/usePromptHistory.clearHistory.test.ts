// WI-FL3.5 — clearHistory reaches the REAL store and leaves the hook in a
// consistent state: the dropdown closes (its entries are memoised on the open
// state, so leaving it open would show rows that no longer exist) and any
// cycling state is dropped.
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePromptHistoryStore } from "@/stores/aiStore";
import { usePromptHistory } from "./usePromptHistory";

beforeEach(() => {
  usePromptHistoryStore.setState({ entries: [] });
});

describe("usePromptHistory.clearHistory", () => {
  it("empties the persisted history and closes an open dropdown", () => {
    usePromptHistoryStore.getState().addEntry("summarise this");
    usePromptHistoryStore.getState().addEntry("translate to French");

    const { result } = renderHook(() => usePromptHistory());
    act(() => result.current.openDropdown());
    expect(result.current.isDropdownOpen).toBe(true);
    expect(result.current.dropdownEntries).toHaveLength(2);

    act(() => result.current.clearHistory());

    expect(usePromptHistoryStore.getState().entries).toEqual([]);
    expect(result.current.isDropdownOpen).toBe(false);
    expect(result.current.dropdownEntries).toEqual([]);
  });

  it("is safe to call with nothing recorded", () => {
    const { result } = renderHook(() => usePromptHistory());
    expect(() => act(() => result.current.clearHistory())).not.toThrow();
    expect(usePromptHistoryStore.getState().entries).toEqual([]);
  });

  it("reopening after a clear shows the empty state, not stale rows", () => {
    usePromptHistoryStore.getState().addEntry("old prompt");
    const { result } = renderHook(() => usePromptHistory());
    act(() => result.current.openDropdown());
    act(() => result.current.clearHistory());
    act(() => result.current.openDropdown());
    expect(result.current.dropdownEntries).toEqual([]);
  });
});
