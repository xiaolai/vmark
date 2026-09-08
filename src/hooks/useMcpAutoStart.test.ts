// useMcpAutoStart — starts the MCP bridge on mount iff the setting is on,
// asks for no port (D9: the bridge binds an OS-assigned one and reports it
// back), runs at most once per hook instance, and swallows start failures
// (logged, not thrown).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const invokeMock = vi.hoisted(() => vi.fn((..._args: unknown[]) => Promise.resolve({ running: true, port: 51234 })));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useSettingsStore } from "@/stores/settingsStore";
import { useMcpAutoStart } from "./useMcpAutoStart";

function setMcpServer(patch: { autoStart: boolean }) {
  const s = useSettingsStore.getState();
  useSettingsStore.setState({
    advanced: {
      ...s.advanced,
      mcpServer: { ...s.advanced.mcpServer, ...patch },
    },
  });
}

beforeEach(() => {
  invokeMock.mockClear();
  invokeMock.mockResolvedValue({ running: true, port: 51234 });
});

describe("useMcpAutoStart", () => {
  it("starts the bridge with NO port argument when autoStart is on", async () => {
    setMcpServer({ autoStart: true });
    renderHook(() => useMcpAutoStart());
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("mcp_bridge_start");
  });

  it("does nothing when autoStart is off", () => {
    setMcpServer({ autoStart: false });
    renderHook(() => useMcpAutoStart());
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("does not start the bridge again on re-render", () => {
    setMcpServer({ autoStart: true });
    const { rerender } = renderHook(() => useMcpAutoStart());
    rerender();
    rerender();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("swallows a bridge start failure instead of surfacing an unhandled rejection", async () => {
    setMcpServer({ autoStart: true });
    invokeMock.mockRejectedValueOnce(new Error("bind failed"));
    renderHook(() => useMcpAutoStart());
    // Flush the rejected promise chain; an unhandled rejection would fail the test run.
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
  });
});
