// @vitest-environment jsdom
/**
 * The two failure modes this hook exists to make impossible — both of which
 * were invisible in the five copied call sites it replaced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockWindowContextError = vi.fn();
vi.mock("@/utils/debug", () => ({ windowContextError: (...a: unknown[]) => mockWindowContextError(...a) }));

import { useWindowReady } from "./useWindowReady";

beforeEach(() => {
  vi.useFakeTimers();
  mockWindowContextError.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("useWindowReady", () => {
  it("flips ready immediately and notifies Rust after the delay", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useWindowReady());
    expect(result.current.isReady).toBe(false);

    act(() => result.current.markReady({ label: "main", emit }));
    expect(result.current.isReady).toBe(true);
    // The delay is the point: children and Rust must both be listening first.
    expect(emit).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(emit).toHaveBeenCalledWith("ready", "main");
  });

  it("does not fire into a webview that unmounted inside the delay", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useWindowReady());
    act(() => result.current.markReady({ label: "doc-1", emit }));
    unmount();

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(emit).not.toHaveBeenCalled();
  });

  it("logs a failed notification instead of raising an unhandled rejection", async () => {
    const emit = vi.fn().mockRejectedValue(new Error("ipc gone"));
    const { result } = renderHook(() => useWindowReady());
    act(() => result.current.markReady({ label: "main", emit }));

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(mockWindowContextError).toHaveBeenCalledWith("ready emit failed:", expect.any(Error));
  });

  it("tolerates an emit that does not return a promise", async () => {
    const emit = vi.fn(() => undefined);
    const { result } = renderHook(() => useWindowReady());
    act(() => result.current.markReady({ label: "main", emit }));

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(emit).toHaveBeenCalled();
    expect(mockWindowContextError).not.toHaveBeenCalled();
  });
});
