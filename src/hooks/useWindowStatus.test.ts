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
