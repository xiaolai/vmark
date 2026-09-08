/**
 * Audit #752 — the dropdown's RAW selected index vs the row it can show.
 *
 * The visible index is the raw one clamped to the current rows. Two things
 * follow, and neither held before: the arrows must step the CLAMPED value (or
 * a filter that shrank the rows leaves presses that move nothing), and an edit
 * must reset it (or re-widening the filter jumps the highlight back to a row
 * the user left long ago).
 *
 * Seeds the REAL store — mock-boundaries forbids mocking one.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePromptHistoryStore } from "@/stores/aiStore";
import { usePromptHistory } from "./usePromptHistory";

const ENTRIES = ["alpha one", "alpha two", "alpha three", "beta only"];

function key(name: string) {
  return {
    key: name,
    isComposing: false,
    keyCode: 0,
    ctrlKey: name === "r",
    metaKey: false,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    currentTarget: { selectionStart: 0, value: "" },
    nativeEvent: { isComposing: false },
  } as unknown as Parameters<ReturnType<typeof usePromptHistory>["handleKeyDown"]>[0];
}

beforeEach(() => {
  usePromptHistoryStore.setState({ entries: [...ENTRIES] });
});

describe("dropdown selection survives a changing filter", () => {
  it("steps ArrowUp from the visible row after the filter shrank the rows", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => result.current.openDropdown());
    act(() => result.current.handleKeyDown(key("ArrowDown")));
    act(() => result.current.handleKeyDown(key("ArrowDown")));
    act(() => result.current.handleKeyDown(key("ArrowDown")));
    expect(result.current.dropdownSelectedIndex).toBe(3);

    // Narrow to two rows: the visible selection clamps to the last one.
    act(() => result.current.handleChange("alpha t"));
    expect(result.current.dropdownEntries).toHaveLength(2);
    expect(result.current.dropdownSelectedIndex).toBe(0);

    // One ArrowDown then one ArrowUp must land back where it started — with a
    // RAW step base this pair moved the highlight nowhere at all.
    act(() => result.current.handleKeyDown(key("ArrowDown")));
    expect(result.current.dropdownSelectedIndex).toBe(1);
    act(() => result.current.handleKeyDown(key("ArrowUp")));
    expect(result.current.dropdownSelectedIndex).toBe(0);
  });

  it("does not jump back to an old row when the filter widens again", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => result.current.openDropdown());
    act(() => result.current.handleKeyDown(key("ArrowDown")));
    act(() => result.current.handleKeyDown(key("ArrowDown")));
    act(() => result.current.handleKeyDown(key("ArrowDown")));
    expect(result.current.dropdownSelectedIndex).toBe(3);

    act(() => result.current.handleChange("alpha t"));
    act(() => result.current.handleChange(""));

    expect(result.current.dropdownEntries).toHaveLength(4);
    expect(result.current.dropdownSelectedIndex).toBe(0);
  });
});
