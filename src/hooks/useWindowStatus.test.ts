// useWindowStatus (#1057) — seeds the store, subscribes to the broadcast,
// reports this window's status, and clears attention on focus.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const invoke = vi.fn();
const listen = vi.fn();
const onFocusChanged = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => listen(...a) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: (...a: unknown[]) => onFocusChanged(...a) }),
}));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "self" }));

import { useWindowStatus } from "./useWindowStatus";
import { useAiInvocationStore } from "@/stores/aiStore";
import { useWindowStatusStore } from "@/stores/windowStatusStore";

beforeEach(() => {
  invoke.mockReset().mockResolvedValue([]);
  listen.mockReset().mockResolvedValue(() => {});
  onFocusChanged.mockReset().mockResolvedValue(() => {});
  useAiInvocationStore.setState({ isRunning: false, error: null, elapsedSeconds: 0 });
});

afterEach(() => vi.clearAllMocks());

describe("useWindowStatus", () => {
  it("seeds the snapshot, subscribes to the broadcast, and reports on mount", async () => {
    renderHook(() => useWindowStatus());

    // Reported + subscribed synchronously; the snapshot fetch runs after the
    // listener is registered (awaited), so wait for it.
    expect(listen).toHaveBeenCalledWith("window-status:changed", expect.any(Function));
    expect(onFocusChanged).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      "report_window_status",
      expect.objectContaining({ ai: "idle", docName: "" }),
    );
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("get_window_statuses"));
  });

  it("reports 'running' when an AI invocation is active", async () => {
    useAiInvocationStore.setState({ isRunning: true, error: null, elapsedSeconds: 2 });
    renderHook(() => useWindowStatus());
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("report_window_status", expect.objectContaining({ ai: "running" })),
    );
  });

  it("subscribes to the app-global pin broadcast (#1135)", async () => {
    renderHook(() => useWindowStatus());
    // Registered after the snapshot listener is awaited, so wait for it.
    await vi.waitFor(() =>
      expect(listen).toHaveBeenCalledWith("window-status:global-pin", expect.any(Function)),
    );
  });

  it("opens the panel on mount when the app-global pin is active (#1135)", () => {
    useWindowStatusStore.setState({ globalPin: true, panelOpen: false });
    renderHook(() => useWindowStatus());
    expect(useWindowStatusStore.getState().panelOpen).toBe(true);
    useWindowStatusStore.setState({ globalPin: false, panelOpen: false });
  });

  it("clears attention when the window gains focus", async () => {
    renderHook(() => useWindowStatus());
    await Promise.resolve();
    const handler = onFocusChanged.mock.calls[0][0] as (e: { payload: boolean }) => void;
    invoke.mockClear();
    handler({ payload: true });
    expect(invoke).toHaveBeenCalledWith("clear_window_attention");
    invoke.mockClear();
    handler({ payload: false }); // blur → no clear
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("useWindowStatus — rehydrate and broadcast plumbing", () => {
  it("reports a failed rehydrate instead of dropping it", async () => {
    // Panel prefs come from window-scoped storage; if that read fails the panel
    // silently opens with defaults, so the failure must reach a log.
    const debug = await import("@/utils/debug");
    const warn = vi.spyOn(debug, "statusBarWarn").mockImplementation(() => {});
    const boom = new Error("storage unreadable");
    const rehydrate = vi
      .spyOn(useWindowStatusStore.persist, "rehydrate")
      .mockRejectedValueOnce(boom);

    renderHook(() => useWindowStatus());
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith("Window-status rehydrate failed:", boom)
    );

    rehydrate.mockRestore();
    warn.mockRestore();
  });

  it("writes a broadcast payload into the store", async () => {
    const captured: ((e: { payload: unknown }) => void)[] = [];
    listen.mockImplementation((_event: string, cb: (e: { payload: unknown }) => void) => {
      captured.push(cb);
      return Promise.resolve(() => {});
    });

    renderHook(() => useWindowStatus());
    await vi.waitFor(() => expect(captured.length).toBeGreaterThan(0));

    const entries = [{ label: "w1", docName: "a.md", ai: "idle", elapsedSeconds: 0 }];
    captured[0]({ payload: entries });
    expect(useWindowStatusStore.getState().windows).toEqual(entries);
  });
});

describe("useWindowStatus — focus clears attention", () => {
  it("clears this window's attention flag when it gains focus", async () => {
    // The attention badge is set by a background window finishing work; focusing
    // this window is what dismisses it, so this callback is the whole feature.
    let onFocus: ((e: { payload: boolean }) => void) | null = null;
    onFocusChanged.mockImplementation((cb: (e: { payload: boolean }) => void) => {
      onFocus = cb;
      return Promise.resolve(() => {});
    });

    renderHook(() => useWindowStatus());
    await vi.waitFor(() => expect(onFocus).not.toBeNull());

    invoke.mockClear();
    onFocus!({ payload: false });
    expect(invoke).not.toHaveBeenCalledWith("clear_window_attention");

    onFocus!({ payload: true });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("clear_window_attention"));
  });
});

describe("useWindowStatus — reporting and global pin", () => {
  it("survives a rejected report_window_status", async () => {
    // Reporting is best-effort telemetry to the coordinator; a failure must not
    // take the hook down with an unhandled rejection.
    invoke.mockImplementation((cmd: string) =>
      cmd === "report_window_status" ? Promise.reject(new Error("ipc down")) : Promise.resolve([])
    );
    useAiInvocationStore.setState({ activeCount: 1 });
    const { unmount } = renderHook(() => useWindowStatus());
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("report_window_status", expect.any(Object))
    );
    expect(() => unmount()).not.toThrow();
  });

  it("follows the app-global pin broadcast from another window", async () => {
    const byEvent = new Map<string, (e: { payload: unknown }) => void>();
    listen.mockImplementation((event: string, cb: (e: { payload: unknown }) => void) => {
      byEvent.set(event, cb);
      return Promise.resolve(() => {});
    });
    useWindowStatusStore.setState({ globalPin: false });

    renderHook(() => useWindowStatus());
    await vi.waitFor(() => expect(byEvent.has("window-status:global-pin")).toBe(true));

    byEvent.get("window-status:global-pin")!({ payload: true });
    expect(useWindowStatusStore.getState().globalPin).toBe(true);
  });
});
