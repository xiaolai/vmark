import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

// Mock tauri APIs before importing the hook
const mockInvoke = vi.fn();
const mockListen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

import { useMcpClients } from "../useMcpClients";

describe("useMcpClients", () => {
  let unlistenFn: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    unlistenFn = vi.fn();
    mockListen.mockResolvedValue(unlistenFn);
    mockInvoke.mockResolvedValue([]);
  });

  it("returns empty array when MCP is not running", () => {
    const { result } = renderHook(() => useMcpClients(false));
    expect(result.current).toEqual([]);
  });

  it("fetches clients on mount when MCP is running", async () => {
    const clients = [{ name: "claude-code", version: "1.2.0" }];
    mockInvoke.mockResolvedValue(clients);

    const { result } = renderHook(() => useMcpClients(true));

    // Wait for async fetch
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockInvoke).toHaveBeenCalledWith("mcp_bridge_connected_clients");
    expect(result.current).toEqual(clients);
  });

  it("listens to clients-changed event when running", async () => {
    mockInvoke.mockResolvedValue([]);

    renderHook(() => useMcpClients(true));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockListen).toHaveBeenCalledWith(
      "mcp-bridge:clients-changed",
      expect.any(Function)
    );
  });

  it("refetches clients when event fires", async () => {
    mockInvoke.mockResolvedValueOnce([]); // initial fetch

    const { result } = renderHook(() => useMcpClients(true));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current).toEqual([]);

    // Simulate event firing with new clients
    const updatedClients = [
      { name: "claude-code", version: "1.2.0" },
      { name: "codex-cli", version: "0.9.0" },
    ];
    mockInvoke.mockResolvedValueOnce(updatedClients);

    // Get the callback passed to listen and invoke it
    const listenCallback = mockListen.mock.calls[0][1];
    await act(async () => {
      listenCallback({});
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current).toEqual(updatedClients);
  });

  it("clears clients when MCP stops", async () => {
    const clients = [{ name: "claude-code", version: "1.2.0" }];
    mockInvoke.mockResolvedValue(clients);

    const { result, rerender } = renderHook(
      ({ running }) => useMcpClients(running),
      { initialProps: { running: true } }
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current).toEqual(clients);

    // MCP stops
    rerender({ running: false });
    expect(result.current).toEqual([]);
  });

  it("cleans up listener on unmount", async () => {
    const { unmount } = renderHook(() => useMcpClients(true));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    unmount();

    // The unlisten function should be called during cleanup
    // (it's async, so we need to wait)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(unlistenFn).toHaveBeenCalled();
  });

  it("handles invoke errors gracefully", async () => {
    mockInvoke.mockRejectedValue(new Error("Bridge not available"));

    const { result } = renderHook(() => useMcpClients(true));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Should remain empty, not throw
    expect(result.current).toEqual([]);
  });
});
