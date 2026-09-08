// Audit 20260907 (#386/#387): ghost text and dropdown rows were memoised over
// `getState()` reads, so a history change alone never re-rendered them — an
// open dropdown kept stale rows; and narrowing the filter left the selected
// index past the end, where Enter closed the dropdown without selecting.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePromptHistoryStore } from "@/stores/aiStore";
import { usePromptHistory } from "./usePromptHistory";

type PromptKeyEvent = React.KeyboardEvent<HTMLTextAreaElement>;

function keyEvent(key: string): PromptKeyEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    currentTarget: { selectionStart: 0, value: "" } as unknown as HTMLTextAreaElement,
    nativeEvent: { isComposing: false, keyCode: 0 },
  } as unknown as PromptKeyEvent;
}

beforeEach(() => {
  usePromptHistoryStore.setState({ entries: [] });
});

describe("history changes re-render the derived views (#386)", () => {
  it("an open dropdown shows an entry added after it opened", () => {
    usePromptHistoryStore.getState().addEntry("old prompt");
    const { result } = renderHook(() => usePromptHistory());
    act(() => result.current.openDropdown());
    expect(result.current.dropdownEntries).toEqual(["old prompt"]);

    act(() => usePromptHistoryStore.getState().addEntry("new prompt"));

    expect(result.current.dropdownEntries).toEqual(["new prompt", "old prompt"]);
  });

  it("ghost text appears once a matching entry exists, without further typing", () => {
    const { result } = renderHook(() => usePromptHistory());
    act(() => result.current.handleChange("trans"));
    expect(result.current.ghostText).toBe("");

    act(() => usePromptHistoryStore.getState().addEntry("translate to French"));

    expect(result.current.ghostText).toBe("late to French");
  });
});

describe("the dropdown selection stays in range when the filter narrows (#387)", () => {
  it("Enter selects the last remaining row instead of silently closing", () => {
    for (const entry of ["alpha one", "alpha two", "beta"]) {
      usePromptHistoryStore.getState().addEntry(entry);
    }
    // MRU order: ["beta", "alpha two", "alpha one"].
    const { result } = renderHook(() => usePromptHistory());
    act(() => result.current.openDropdown());
    act(() => result.current.handleKeyDown(keyEvent("ArrowDown")));
    act(() => result.current.handleKeyDown(keyEvent("ArrowDown")));
    expect(result.current.dropdownSelectedIndex).toBe(2);

    // Narrow the filter to one row; the index must clamp to it.
    act(() => result.current.handleChange("beta"));
    expect(result.current.dropdownEntries).toEqual(["beta"]);
    expect(result.current.dropdownSelectedIndex).toBe(0);

    act(() => result.current.handleKeyDown(keyEvent("Enter")));
    expect(result.current.isDropdownOpen).toBe(false);
    expect(result.current.displayValue).toBe("beta");
  });

  // Round 3: the clamp had an upper bound only, so ArrowDown against an EMPTY
  // result set drove the raw index to -1 (`Math.min(prev + 1, -1)`) and it
  // stayed there when rows came back — `dropdownEntries[-1]` is undefined, so
  // Enter closed the dropdown selecting nothing, which is the very symptom
  // #387 was filed for.
  it("ArrowDown on an empty result set leaves a selectable index when rows return", () => {
    usePromptHistoryStore.getState().addEntry("beta");
    const { result } = renderHook(() => usePromptHistory());
    act(() => result.current.openDropdown());

    // Filter down to nothing, then press ArrowDown into the void.
    act(() => result.current.handleChange("zzz"));
    expect(result.current.dropdownEntries).toEqual([]);
    act(() => result.current.handleKeyDown(keyEvent("ArrowDown")));
    expect(result.current.dropdownSelectedIndex).toBe(0);

    // Rows come back; the first one must be selectable.
    act(() => result.current.handleChange("bet"));
    expect(result.current.dropdownEntries).toEqual(["beta"]);
    expect(result.current.dropdownSelectedIndex).toBe(0);

    act(() => result.current.handleKeyDown(keyEvent("Enter")));
    expect(result.current.isDropdownOpen).toBe(false);
    expect(result.current.displayValue).toBe("beta");
  });
});
