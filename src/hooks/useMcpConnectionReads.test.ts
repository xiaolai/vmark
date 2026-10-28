// WI-AL1.5 — the window listens for the bridge's connection-closed and
// server-stopped events and hands them to the read-tracking cleanup, so a
// closed client's reads (client A) leave no partition behind while the other
// client's (client B) stay. Listeners are removed on unmount, including the
// Strict Mode case where unmount precedes listen() resolving.

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockListen, mockClosed, mockStopped, mockError, handlers } = vi.hoisted(() => ({
  mockListen: vi.fn(),
  mockError: vi.fn(),
  mockClosed: vi.fn(),
  mockStopped: vi.fn(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));
vi.mock("@/utils/debug", () => ({
  mcpBridgeError: (...args: unknown[]) => mockError(...args),
}));
vi.mock("@/services/mcpBridge/connectionClosed", () => ({
  handleMcpConnectionClosed: (payload: unknown) => mockClosed(payload),
  handleMcpBridgeStopped: () => mockStopped(),
}));

import { REGISTER_RETRY_DELAYS_MS, useMcpConnectionReads } from "./useMcpConnectionReads";

const unlisten = vi.fn();

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  mockListen.mockImplementation((event: string, handler: (e: { payload: unknown }) => void) => {
    handlers.set(event, handler);
    return Promise.resolve(unlisten);
  });
});

describe("useMcpConnectionReads", () => {
  it("forwards a connection-closed payload, untouched, to the cleanup", async () => {
    renderHook(() => useMcpConnectionReads());
    await flush();
    const payload = { connectionId: "00000000-0000-4000-8000-000000a10000" };
    handlers.get("mcp-bridge:connection-closed")?.({ payload });
    expect(mockClosed).toHaveBeenCalledWith(payload);
  });

  it("drops every connection's reads when the bridge stops", async () => {
    renderHook(() => useMcpConnectionReads());
    await flush();
    handlers.get("mcp-server:stopped")?.({ payload: null });
    expect(mockStopped).toHaveBeenCalledTimes(1);
  });

  it("removes both listeners on unmount", async () => {
    const { unmount } = renderHook(() => useMcpConnectionReads());
    await flush();
    unmount();
    await flush();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it("removes a listener that resolves after unmount (Strict Mode)", async () => {
    let resolveLate: (fn: () => void) => void = () => {};
    mockListen.mockImplementation(
      () => new Promise<() => void>((resolve) => { resolveLate = resolve; }),
    );
    const late = vi.fn();
    const { unmount } = renderHook(() => useMcpConnectionReads());
    unmount();
    resolveLate(late);
    await flush();
    expect(late).toHaveBeenCalled();
  });

  it("logs a failed registration and still unmounts cleanly", async () => {
    mockListen.mockImplementation(() => Promise.reject(new Error("no ipc")));
    const { unmount } = renderHook(() => useMcpConnectionReads());
    await flush();
    expect(mockError).toHaveBeenCalledWith(
      "Failed to register mcp-bridge:connection-closed listener:",
      expect.any(Error),
    );
    expect(() => unmount()).not.toThrow();
    await flush();
  });

  describe("a failed registration is retried while mounted", () => {
    const CLOSED = "mcp-bridge:connection-closed";
    const calls = (event: string) => mockListen.mock.calls.filter(([e]) => e === event).length;
    const total = REGISTER_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("backs off a bounded number of times", () => {
      expect(REGISTER_RETRY_DELAYS_MS.length).toBeGreaterThan(0);
      expect([...REGISTER_RETRY_DELAYS_MS]).toEqual([...REGISTER_RETRY_DELAYS_MS].sort((a, b) => a - b));
    });

    it("registers on a retry and then forwards events", async () => {
      mockListen.mockImplementationOnce(() => Promise.reject(new Error("ipc not ready")));
      renderHook(() => useMcpConnectionReads());
      await vi.advanceTimersByTimeAsync(0);
      expect(calls(CLOSED)).toBe(1);
      await vi.advanceTimersByTimeAsync(REGISTER_RETRY_DELAYS_MS[0]);
      expect(calls(CLOSED)).toBe(2);
      handlers.get(CLOSED)?.({ payload: { connectionId: "c" } });
      expect(mockClosed).toHaveBeenCalledWith({ connectionId: "c" });
    });

    it("gives up loudly after the last retry and asks no more", async () => {
      mockListen.mockImplementation(() => Promise.reject(new Error("no ipc")));
      renderHook(() => useMcpConnectionReads());
      await vi.advanceTimersByTimeAsync(total);
      expect(calls(CLOSED)).toBe(REGISTER_RETRY_DELAYS_MS.length + 1);
      expect(mockError).toHaveBeenCalledWith(expect.stringMatching(/^Giving up registering mcp-bridge:connection-closed/), expect.any(Error));
      await vi.advanceTimersByTimeAsync(10 * total);
      expect(calls(CLOSED)).toBe(REGISTER_RETRY_DELAYS_MS.length + 1);
    });

    it("stops retrying once unmounted", async () => {
      mockListen.mockImplementation(() => Promise.reject(new Error("no ipc")));
      const { unmount } = renderHook(() => useMcpConnectionReads());
      await vi.advanceTimersByTimeAsync(0);
      unmount();
      await vi.advanceTimersByTimeAsync(10 * total);
      expect(calls(CLOSED)).toBe(1);
    });

    it("removes a listener a retry registers after unmount", async () => {
      let resolveLate: (fn: () => void) => void = () => {};
      mockListen
        .mockImplementationOnce(() => Promise.reject(new Error("ipc not ready")))
        .mockImplementationOnce(() => Promise.resolve(unlisten))
        .mockImplementationOnce(() => new Promise<() => void>((resolve) => (resolveLate = resolve)));
      const late = vi.fn();
      const { unmount } = renderHook(() => useMcpConnectionReads());
      await vi.advanceTimersByTimeAsync(REGISTER_RETRY_DELAYS_MS[0] - 1);
      await vi.advanceTimersByTimeAsync(1);
      unmount();
      resolveLate(late);
      await vi.advanceTimersByTimeAsync(0);
      expect(late).toHaveBeenCalled();
    });
  });
});
