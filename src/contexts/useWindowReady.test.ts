// @vitest-environment jsdom
/**
 * The failure modes this hook exists to make impossible — all of which were
 * invisible in the five copied call sites it replaced, plus the one the fixed
 * 100 ms delay could never close.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockWindowContextError = vi.fn();
vi.mock("@/utils/debug", () => ({ windowContextError: (...a: unknown[]) => mockWindowContextError(...a) }));

import { READY_ATTRIBUTE, useWindowReady } from "./useWindowReady";
import {
  signalMenuCommandsMounted,
  resetMenuCommandsForTest,
} from "@/services/commands/menuCommandsReady";

beforeEach(() => {
  vi.useFakeTimers();
  mockWindowContextError.mockReset();
  resetMenuCommandsForTest();
  document.documentElement.removeAttribute(READY_ATTRIBUTE);
});
afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute(READY_ATTRIBUTE);
});

const readyAttr = () => document.documentElement.getAttribute(READY_ATTRIBUTE);

/** What actually completes the handshake in production: the listener mounts. */
async function mountMenuListener() {
  await act(async () => {
    signalMenuCommandsMounted();
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Let every scheduled delay and pending microtask run out. */
async function settle(ms = 200) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe("useWindowReady", () => {
  it("flips ready immediately and notifies Rust once the menu listener mounts", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useWindowReady());
    expect(result.current.isReady).toBe(false);

    act(() => result.current.markReady({ label: "main", emit }));
    // `isReady` gates RENDERING, so it flips at once — the children have to
    // mount before they can register anything.
    expect(result.current.isReady).toBe(true);
    expect(emit).not.toHaveBeenCalled();

    await mountMenuListener();
    expect(emit).toHaveBeenCalledWith("ready", "main");
  });

  // The core of the fix. `useCommandBootstrap` awaits a DYNAMIC IMPORT before
  // mounting the menu listener, so no constant bounds it. Under the old design
  // the clock alone released the handshake; here time passing changes nothing.
  it("does not announce a document window on time alone", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useWindowReady());
    act(() => result.current.markReady({ label: "doc-1", emit }));

    // Well past the delay this replaced, and past any plausible successor.
    await settle(4_900);
    expect(emit).not.toHaveBeenCalled();
    expect(readyAttr()).toBeNull();

    await mountMenuListener();
    expect(emit).toHaveBeenCalledWith("ready", "doc-1");
  });

  it("announces anyway, loudly, when the barrier never signals", async () => {
    // A window that never reports ready is unusable, so the budget must expire
    // into the old behaviour rather than into a hang. It must not do so
    // QUIETLY: a silent expiry is indistinguishable from success.
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useWindowReady());
    act(() => result.current.markReady({ label: "main", emit }));

    await settle(5_000);

    expect(emit).toHaveBeenCalledWith("ready", "main");
    expect(readyAttr()).toBe("true");
    expect(mockWindowContextError).toHaveBeenCalledWith(
      expect.stringContaining("menu commands did not mount"),
    );
  });

  it("does not make a settings window wait for a barrier it never signals", async () => {
    // Settings and pdf-export windows render their own route and mount no menu
    // listener at all. Waiting on the barrier would stall them for the whole
    // budget and then log an error for a thing that was never going to happen.
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useWindowReady());
    act(() => result.current.markReady({ label: "settings", emit }));

    await settle(200);

    expect(emit).toHaveBeenCalledWith("ready", "settings");
    expect(mockWindowContextError).not.toHaveBeenCalled();
  });

  // The attribute is what an automation harness gates on — see
  // e2e/lib/readiness.mjs. Its whole value is that it is never true earlier
  // than the fact it reports, so the timing assertions below are the point.
  it("publishes readiness to the DOM only after the listener is mounted", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useWindowReady());

    act(() => result.current.markReady({ label: "main", emit }));
    expect(readyAttr()).toBeNull();

    await mountMenuListener();
    expect(readyAttr()).toBe("true");
  });

  it("publishes readiness even when the notification to Rust fails", async () => {
    // The attribute reports what THIS window finished doing, not whether Rust
    // acknowledged it. Gating on the emit would leave a fully-listening window
    // advertising itself as unready forever.
    const emit = vi.fn().mockRejectedValue(new Error("ipc gone"));
    const { result } = renderHook(() => useWindowReady());

    act(() => result.current.markReady({ label: "main", emit }));
    await mountMenuListener();

    expect(readyAttr()).toBe("true");
  });

  it("does not publish readiness for a window that unmounted before the barrier", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useWindowReady());
    act(() => result.current.markReady({ label: "doc-1", emit }));
    unmount();

    await mountMenuListener();
    await settle();

    expect(readyAttr()).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  it("does not publish readiness for a settings window that unmounted inside the delay", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useWindowReady());
    act(() => result.current.markReady({ label: "settings", emit }));
    unmount();

    await settle();

    expect(readyAttr()).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  // Audit finding #11. `Promise.resolve(x)` only converts a RETURNED value; if
  // `emit` throws synchronously the exception escapes, so the attribute below
  // it never runs and the window advertises itself as never-ready — a
  // permanent hang for anything gating on it.
  it("publishes readiness even when emit throws synchronously", async () => {
    const emit = vi.fn(() => { throw new Error("bridge gone"); });
    const { result } = renderHook(() => useWindowReady());

    act(() => result.current.markReady({ label: "main", emit }));
    await mountMenuListener();

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
    await mountMenuListener();
    await settle();

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("emits once for a settings window called repeatedly", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useWindowReady());

    act(() => {
      result.current.markReady({ label: "settings", emit });
      result.current.markReady({ label: "settings", emit });
    });
    await settle();

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("logs a failed notification instead of raising an unhandled rejection", async () => {
    const emit = vi.fn().mockRejectedValue(new Error("ipc gone"));
    const { result } = renderHook(() => useWindowReady());
    act(() => result.current.markReady({ label: "main", emit }));

    await mountMenuListener();
    await settle();
    expect(mockWindowContextError).toHaveBeenCalledWith("ready emit failed:", expect.any(Error));
  });

  it("tolerates an emit that does not return a promise", async () => {
    const emit = vi.fn(() => undefined);
    const { result } = renderHook(() => useWindowReady());
    act(() => result.current.markReady({ label: "main", emit }));

    await mountMenuListener();
    expect(emit).toHaveBeenCalled();
    expect(mockWindowContextError).not.toHaveBeenCalled();
  });
});
