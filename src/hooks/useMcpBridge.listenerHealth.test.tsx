// Window-local MCP request-listener health, end to end: useMcpBridge records
// whether this window's `mcp-bridge:request` listener registered, and the
// status bar shows a persistent warning once every registration attempt has
// failed. The state is STORED, so a warning mounted after the failure still
// shows it (no one-shot event to miss). Covers: all attempts exhausted then
// the indicator mounted (warning + stopped heartbeat), the indicator mounted
// first, a retry that succeeds (no warning, heartbeat continues), and React
// Strict Mode's mount-cleanup-mount (the discarded first mount neither leaks
// a listener nor decides the health), plus teardown clearing the warning.

import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockListen, mockInvoke } = vi.hoisted(() => ({
  mockListen: vi.fn(),
  mockInvoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: (...args: unknown[]) => mockListen(...args),
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@/utils/debug", () => ({
  mcpBridgeLog: vi.fn(),
  mcpBridgeError: vi.fn(),
}));

import { LISTEN_ATTEMPTS, LISTEN_RETRY_MS, useMcpBridge } from "./useMcpBridge";
import { McpBridgeListenerWarning } from "@/components/StatusBar/McpBridgeListenerWarning";
import { useMcpBridgeListenerStore } from "@/stores/mcpBridgeListenerStore";

const WARNING = /MCP unavailable in this window/i;
const refuse = () => Promise.reject(new Error("no ipc"));
const unlisten = vi.fn();
const accept = () => Promise.resolve(unlisten);

/** Heartbeats sent so far. */
const beats = () => mockInvoke.mock.calls.filter(([cmd]) => cmd === "mcp_bridge_heartbeat").length;

/** Run every registration attempt and its backoff to completion. */
async function exhaustRegistrations(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10 * 60_000);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useMcpBridgeListenerStore.setState({ status: "registering" });
  mockInvoke.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MCP bridge listener health", () => {
  it("shows the warning when the indicator mounts after all registrations failed, and the heartbeat stops", async () => {
    mockListen.mockImplementation(refuse);
    renderHook(() => useMcpBridge());
    await exhaustRegistrations();
    expect(mockListen).toHaveBeenCalledTimes(LISTEN_ATTEMPTS);

    render(<McpBridgeListenerWarning />);
    expect(screen.getByRole("status")).toHaveTextContent(WARNING);

    const before = beats();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(beats()).toBe(before);
    // Still there: the warning is persistent, not a toast.
    expect(screen.getByRole("status")).toHaveTextContent(WARNING);
  });

  it("an indicator mounted first stays silent while retries remain, then warns", async () => {
    mockListen.mockImplementation(refuse);
    render(<McpBridgeListenerWarning />);
    renderHook(() => useMcpBridge());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LISTEN_RETRY_MS);
    });
    expect(mockListen.mock.calls.length).toBeLessThan(LISTEN_ATTEMPTS);
    expect(screen.queryByText(WARNING)).toBeNull();

    await exhaustRegistrations();
    expect(screen.getByText(WARNING)).toBeInTheDocument();
  });

  it("a retry that succeeds leaves no warning and keeps the heartbeat", async () => {
    mockListen.mockImplementationOnce(refuse).mockImplementationOnce(refuse).mockImplementation(accept);
    renderHook(() => useMcpBridge());
    await exhaustRegistrations();
    expect(mockListen).toHaveBeenCalledTimes(3);
    expect(useMcpBridgeListenerStore.getState().status).toBe("listening");

    render(<McpBridgeListenerWarning />);
    expect(screen.queryByText(WARNING)).toBeNull();

    const before = beats();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(beats()).toBe(before + 2);
  });

  // React Strict Mode runs effect → cleanup → effect. This test environment
  // does not double-invoke effects under <StrictMode> (one run, probed), so
  // the sequence is driven explicitly: mount, unmount at once, mount again.
  it("Strict Mode: the discarded first mount releases its listener and the second decides health", async () => {
    mockListen.mockImplementation(accept);
    const first = renderHook(() => useMcpBridge());
    first.unmount(); // its registration is still pending
    renderHook(() => useMcpBridge());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockListen).toHaveBeenCalledTimes(2);
    expect(unlisten).toHaveBeenCalledTimes(1); // the first mount's, released on arrival
    expect(useMcpBridgeListenerStore.getState().status).toBe("listening");
  });

  it("Strict Mode: a failure that settles after the first mount's cleanup does not count", async () => {
    mockListen.mockImplementationOnce(refuse).mockImplementation(accept);
    const first = renderHook(() => useMcpBridge());
    first.unmount();
    renderHook(() => useMcpBridge());
    await exhaustRegistrations();
    expect(mockListen).toHaveBeenCalledTimes(2); // the discarded mount never retried
    expect(useMcpBridgeListenerStore.getState().status).toBe("listening");
  });

  it("unmounting clears the warning: health describes the live registration only", async () => {
    mockListen.mockImplementation(refuse);
    const { unmount } = renderHook(() => useMcpBridge());
    await exhaustRegistrations();
    expect(useMcpBridgeListenerStore.getState().status).toBe("failed");

    act(() => unmount());
    expect(useMcpBridgeListenerStore.getState().status).toBe("registering");
  });
});
