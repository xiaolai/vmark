/**
 * Tests for useAutoSaveDisplay — the StatusBar auto-save indicator's
 * show/fade/update lifecycle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/utils/dateUtils", () => ({
  formatRelativeTime: (ts: number) => `t-${ts}`,
}));

import { useAutoSaveDisplay } from "./useAutoSaveDisplay";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoSaveDisplay", () => {
  it("is hidden with no auto-save timestamp", () => {
    const { result } = renderHook(() => useAutoSaveDisplay(null));
    expect(result.current.showAutoSave).toBe(false);
    expect(result.current.autoSaveTime).toBe("");
  });

  it("shows the label on a new auto-save", () => {
    const { result } = renderHook(() => useAutoSaveDisplay(1000));
    expect(result.current.showAutoSave).toBe(true);
    expect(result.current.autoSaveTime).toBe("t-1000");
  });

  it("fades out after 5 seconds", () => {
    const { result } = renderHook(() => useAutoSaveDisplay(1000));
    expect(result.current.showAutoSave).toBe(true);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.showAutoSave).toBe(false);
  });

  it("keeps the label current on the 10s interval after fade", () => {
    const { result } = renderHook(() => useAutoSaveDisplay(1000));
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    // Still tracking the same timestamp; label recomputed.
    expect(result.current.autoSaveTime).toBe("t-1000");
  });

  it("re-shows on a fresh timestamp after it had faded", () => {
    const { result, rerender } = renderHook(
      ({ ts }: { ts: number | null }) => useAutoSaveDisplay(ts),
      { initialProps: { ts: 1000 as number | null } },
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.showAutoSave).toBe(false);

    rerender({ ts: 2000 });
    expect(result.current.showAutoSave).toBe(true);
    expect(result.current.autoSaveTime).toBe("t-2000");
  });
});
