// @vitest-environment jsdom
/**
 * The two failure modes this hook exists to make impossible — both of which
 * were invisible in the five copied call sites it replaced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockWindowContextError = vi.fn();
vi.mock("@/utils/debug", () => ({ windowContextError: (...a: unknown[]) => mockWindowContextError(...a) }));

import { READY_ATTRIBUTE, useWindowReady } from "./useWindowReady";

beforeEach(() => {
  vi.useFakeTimers();
  mockWindowContextError.mockReset();
  document.documentElement.removeAttribute(READY_ATTRIBUTE);
});
afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute(READY_ATTRIBUTE);
});

const readyAttr = () => document.documentElement.getAttribute(READY_ATTRIBUTE);

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

  // The attribute is what an automation harness gates on — see
  // e2e/lib/readiness.mjs. Its whole value is that it is never true earlier
  // than the fact it reports, so the timing assertions below are the point.
  it("publishes readiness to the DOM only after the delay", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useWindowReady());

    act(() => result.current.markReady({ label: "main", emit }));
    // isReady is already true here; the attribute must NOT be, or a harness
    // could act into a window whose children have not finished mounting.
    expect(readyAttr()).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(readyAttr()).toBe("true");
  });

  it("publishes readiness even when the notification to Rust fails", async () => {
    // The attribute reports what THIS window finished doing, not whether Rust
    // acknowledged it. Gating on the emit would leave a fully-listening window
    // advertising itself as unready forever.
    const emit = vi.fn().mockRejectedValue(new Error("ipc gone"));
    const { result } = renderHook(() => useWindowReady());

    act(() => result.current.markReady({ label: "main", emit }));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    expect(readyAttr()).toBe("true");
  });

  it("does not publish readiness for a window that unmounted inside the delay", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useWindowReady());
    act(() => result.current.markReady({ label: "doc-1", emit }));
    unmount();

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    expect(readyAttr()).toBeNull();
  });

  // Audit finding #11. `Promise.resolve(x)` only converts a RETURNED value; if
  // `emit` throws synchronously the exception escapes the timer callback, so
  // the attribute below it never runs and the window advertises itself as
  // never-ready — a permanent hang for anything gating on it.
  it("publishes readiness even when emit throws synchronously", async () => {
    const emit = vi.fn(() => { throw new Error("bridge gone"); });
    const { result } = renderHook(() => useWindowReady());

    act(() => result.current.markReady({ label: "main", emit }));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    expect(readyAttr()).toBe("true");
    expect(mockWindowContextError).toHaveBeenCalledWith("ready emit failed:", expect.any(Error));
  });

  // Audit finding #12. Two markReady calls overwrote timerRef, orphaning the
  // first timer: it still fired, emitting `ready` twice and writing into a
  // webview the cleanup believed it had disarmed.
  it("emits once when markReady is called repeatedly", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useWindowReady());

    act(() => {
      result.current.markReady({ label: "main", emit });
      result.current.markReady({ label: "main", emit });
      result.current.markReady({ label: "main", emit });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("disarms every scheduled timer on unmount, not just the last", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useWindowReady());
    act(() => {
      result.current.markReady({ label: "main", emit });
      result.current.markReady({ label: "main", emit });
    });
    unmount();

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    expect(emit).not.toHaveBeenCalled();
    expect(readyAttr()).toBeNull();
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
