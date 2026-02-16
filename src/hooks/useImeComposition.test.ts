import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImeComposition } from "./useImeComposition";

describe("useImeComposition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with composingRef as false", () => {
    const { result } = renderHook(() => useImeComposition());
    expect(result.current.composingRef.current).toBe(false);
  });

  it("sets composingRef to true on compositionStart", () => {
    const { result } = renderHook(() => useImeComposition());
    act(() => {
      result.current.onCompositionStart();
    });
    expect(result.current.composingRef.current).toBe(true);
  });

  it("resets composingRef to false on compositionEnd", () => {
    const { result } = renderHook(() => useImeComposition());
    act(() => {
      result.current.onCompositionStart();
    });
    expect(result.current.composingRef.current).toBe(true);
    act(() => {
      result.current.onCompositionEnd();
    });
    expect(result.current.composingRef.current).toBe(false);
  });

  it("returns stable callback references across renders", () => {
    const { result, rerender } = renderHook(() => useImeComposition());
    const first = {
      onCompositionStart: result.current.onCompositionStart,
      onCompositionEnd: result.current.onCompositionEnd,
      isComposing: result.current.isComposing,
    };
    rerender();
    expect(result.current.onCompositionStart).toBe(first.onCompositionStart);
    expect(result.current.onCompositionEnd).toBe(first.onCompositionEnd);
    expect(result.current.isComposing).toBe(first.isComposing);
  });

  describe("isComposing() with grace period", () => {
    it("returns true during active composition", () => {
      const { result } = renderHook(() => useImeComposition());
      act(() => {
        result.current.onCompositionStart();
      });
      expect(result.current.isComposing()).toBe(true);
    });

    it("returns true within 50ms grace period after compositionEnd", () => {
      const { result } = renderHook(() => useImeComposition());
      act(() => {
        result.current.onCompositionStart();
        result.current.onCompositionEnd();
      });
      // Immediately after compositionEnd — within grace period
      expect(result.current.isComposing()).toBe(true);

      // At 30ms — still within grace period
      vi.advanceTimersByTime(30);
      expect(result.current.isComposing()).toBe(true);
    });

    it("returns false after grace period expires", () => {
      const { result } = renderHook(() => useImeComposition());
      act(() => {
        result.current.onCompositionStart();
        result.current.onCompositionEnd();
      });

      // Advance past the 50ms grace period
      vi.advanceTimersByTime(60);
      expect(result.current.isComposing()).toBe(false);
    });

    it("returns false when never composed", () => {
      const { result } = renderHook(() => useImeComposition());
      expect(result.current.isComposing()).toBe(false);
    });
  });
});
