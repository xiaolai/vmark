/**
 * usePromptHistory IME Guard Tests
 *
 * Verifies that IME composition events are blocked from triggering
 * history cycling, dropdown navigation, and ghost text acceptance.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/stores/promptHistoryStore", () => ({
  usePromptHistoryStore: Object.assign(
    (selector: (s: { entries: string[] }) => unknown) => selector({ entries: ["hello", "world"] }),
    {
      getState: () => ({
        entries: ["hello", "world"],
        addEntry: vi.fn(),
        getFilteredEntries: () => ["hello", "world"],
      }),
      subscribe: vi.fn(() => () => {}),
    }
  ),
}));

import { usePromptHistory } from "./usePromptHistory";

describe("usePromptHistory — IME composition guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeKeyEvent(overrides: Record<string, unknown>) {
    const isComposing = (overrides.isComposing ?? false) as boolean;
    const keyCode = (overrides.keyCode ?? 13) as number;
    return {
      key: "Enter",
      isComposing,
      keyCode,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: { selectionStart: 0, value: "" } as unknown as HTMLTextAreaElement,
      nativeEvent: { isComposing, keyCode },
      ...overrides,
    } as unknown as React.KeyboardEvent<HTMLTextAreaElement>;
  }

  it("blocks ArrowUp with isComposing during history cycling", () => {
    const { result } = renderHook(() => usePromptHistory());
    const e = makeKeyEvent({ key: "ArrowUp", isComposing: true });

    act(() => {
      result.current.handleKeyDown(e);
    });

    // Should not have entered cycling mode
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });

  it("blocks keyCode 229 (IME marker)", () => {
    const { result } = renderHook(() => usePromptHistory());
    const e = makeKeyEvent({ key: "ArrowUp", keyCode: 229 });

    act(() => {
      result.current.handleKeyDown(e);
    });

    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("allows ArrowUp without IME composition", () => {
    const { result } = renderHook(() => usePromptHistory());
    const e = makeKeyEvent({ key: "ArrowUp", isComposing: false, keyCode: 38 });

    act(() => {
      result.current.handleKeyDown(e);
    });

    // Should enter cycling mode (prevented + stopped)
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it("blocks keyDown when isComposing callback returns true (grace period)", () => {
    const isComposing = vi.fn(() => true);
    const { result } = renderHook(() => usePromptHistory(isComposing));
    const e = makeKeyEvent({ key: "ArrowUp", isComposing: false, keyCode: 38 });

    act(() => {
      result.current.handleKeyDown(e);
    });

    expect(isComposing).toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
