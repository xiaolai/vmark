/**
 * useUpdateSync — regression tests for the cross-window broadcast loop.
 *
 * The original symmetric design (both windows mount Broadcast + Listener)
 * had a feedback loop: when Settings broadcast {checking}, Main's listener
 * applied it, Main's broadcast effect emitted Main's new {checking} state
 * back to Settings, Settings's listener applied it onto its now-{error}
 * state, flipping back to {checking}, and so on — thousands of cycles per
 * second until the React event loop saturated and the app froze.
 *
 * These tests pin the echo-suppression behaviour: applying a remote payload
 * must not trigger an echo emit, while a subsequent local-origin state
 * change must.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const emitMock = vi.fn<(event: string, payload?: unknown) => Promise<void>>(async () => undefined);
type ListenCallback = (event: { payload: unknown }) => void;
let listenCallback: ListenCallback | null = null;
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  emit: (event: string, payload?: unknown) => emitMock(event, payload),
  listen: vi.fn(async (_event: string, cb: ListenCallback) => {
    listenCallback = cb;
    return unlistenMock;
  }),
}));

import { useUpdateBroadcast, useUpdateListener, __resetUpdateSyncStateForTests } from "./useUpdateSync";
import { useMcpStore } from "../stores/mcpStore";

const UPDATE_STATE_EVENT = "update:state-changed";

function resetStore() {
  useMcpStore.getState().resetUpdate();
}

describe("useUpdateSync echo suppression", () => {
  beforeEach(() => {
    emitMock.mockClear();
    listenCallback = null;
    __resetUpdateSyncStateForTests();
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  it("does not echo a remote-applied payload back to peers", async () => {
    // Mount both hooks (same window — like Main or Settings in production)
    renderHook(() => {
      useUpdateBroadcast();
      useUpdateListener();
    });

    // Wait for listener registration microtask
    await act(async () => { await Promise.resolve(); });
    expect(listenCallback).not.toBeNull();

    // Initial mount emits the idle baseline once (prevState was null).
    emitMock.mockClear();

    // Simulate a peer broadcasting "checking"
    await act(async () => {
      listenCallback!({
        payload: {
          status: "checking",
          updateInfo: null,
          downloadProgress: null,
          error: null,
        },
      });
    });

    // The listener applied the payload, the broadcast effect ran, observed
    // that the new state matches what was just applied from a remote, and
    // suppressed the echo. ZERO emits.
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("does not echo a remote-applied error payload back to peers", async () => {
    renderHook(() => {
      useUpdateBroadcast();
      useUpdateListener();
    });
    await act(async () => { await Promise.resolve(); });
    emitMock.mockClear();

    await act(async () => {
      listenCallback!({
        payload: {
          status: "error",
          updateInfo: null,
          downloadProgress: null,
          error: "Failed to check for updates",
        },
      });
    });

    expect(emitMock).not.toHaveBeenCalled();
    const state = useMcpStore.getState().update;
    expect(state.status).toBe("error");
    expect(state.error).toBe("Failed to check for updates");
  });

  it("still emits local-origin changes that follow a remote application", async () => {
    renderHook(() => {
      useUpdateBroadcast();
      useUpdateListener();
    });
    await act(async () => { await Promise.resolve(); });
    emitMock.mockClear();

    // Peer broadcasts checking → suppressed (no echo).
    await act(async () => {
      listenCallback!({
        payload: { status: "checking", updateInfo: null, downloadProgress: null, error: null },
      });
    });
    expect(emitMock).not.toHaveBeenCalled();

    // Local code now changes state — must emit.
    await act(async () => {
      useMcpStore.getState().setUpdateStatus("up-to-date");
    });

    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(
      UPDATE_STATE_EVENT,
      expect.objectContaining({ status: "up-to-date" }),
    );
  });

  it("breaks the A↔B feedback loop: a contradictory remote pair does not generate emits", async () => {
    // Reproduce the v0.7.13 freeze scenario in a single window: a peer
    // delivers `checking` immediately followed by `error`, each of which
    // would otherwise trigger our own broadcast effect to re-emit.
    renderHook(() => {
      useUpdateBroadcast();
      useUpdateListener();
    });
    await act(async () => { await Promise.resolve(); });
    emitMock.mockClear();

    await act(async () => {
      listenCallback!({
        payload: { status: "checking", updateInfo: null, downloadProgress: null, error: null },
      });
    });
    await act(async () => {
      listenCallback!({
        payload: { status: "error", updateInfo: null, downloadProgress: null, error: "boom" },
      });
    });

    expect(emitMock).not.toHaveBeenCalled();
    const state = useMcpStore.getState().update;
    expect(state.status).toBe("error");
    expect(state.error).toBe("boom");
  });
});
