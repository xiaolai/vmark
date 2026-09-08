// Audit R3 #650 — the window-focus safety net, out of `useFileTree`.
//
// Its whole risk is the ASYNC registration: the listener is asked for in an
// effect and arrives a microtask later, so an unmount in that window has
// nothing to unlisten yet and would leak the subscription for the life of the
// process.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const state = vi.hoisted(() => ({
  handler: null as ((e: { payload: boolean }) => void) | null,
  unlisten: vi.fn(),
  /** Resolves the `onFocusChanged` promise on demand. */
  release: null as (() => void) | null,
  fail: false,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onFocusChanged: (handler: (e: { payload: boolean }) => void) =>
      new Promise((resolve, reject) => {
        state.handler = handler;
        state.release = () => (state.fail ? reject(new Error("no window")) : resolve(state.unlisten));
      }),
  }),
}));

vi.mock("@/utils/debug", () => ({ fileExplorerError: vi.fn() }));

import { useRefreshOnWindowFocus } from "./useRefreshOnWindowFocus";

beforeEach(() => {
  state.handler = null;
  state.release = null;
  state.fail = false;
  state.unlisten.mockReset();
});

async function settle(): Promise<void> {
  await act(async () => {
    state.release?.();
    await Promise.resolve();
  });
}

describe("useRefreshOnWindowFocus", () => {
  it("calls back when the window regains focus, and not when it loses it", async () => {
    const onFocus = vi.fn();
    renderHook(() => useRefreshOnWindowFocus(true, onFocus));
    await settle();

    act(() => state.handler?.({ payload: false }));
    expect(onFocus).not.toHaveBeenCalled();

    act(() => state.handler?.({ payload: true }));
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("subscribes to nothing while disabled", async () => {
    renderHook(() => useRefreshOnWindowFocus(false, vi.fn()));
    await settle();
    expect(state.handler).toBeNull();
  });

  it("unlistens on unmount", async () => {
    const { unmount } = renderHook(() => useRefreshOnWindowFocus(true, vi.fn()));
    await settle();
    unmount();
    expect(state.unlisten).toHaveBeenCalledTimes(1);
  });

  it("unlistens IMMEDIATELY when the registration resolves after unmount", async () => {
    // The window between "asked to listen" and "listening" is the leak: there
    // is nothing to tear down yet, so the teardown has to leave a flag behind.
    const { unmount } = renderHook(() => useRefreshOnWindowFocus(true, vi.fn()));
    unmount();
    await settle();
    expect(state.unlisten).toHaveBeenCalledTimes(1);
  });

  it("logs rather than throwing when the window cannot be listened to", async () => {
    state.fail = true;
    const { unmount } = renderHook(() => useRefreshOnWindowFocus(true, vi.fn()));
    await settle();
    expect(() => unmount()).not.toThrow();
  });
});
