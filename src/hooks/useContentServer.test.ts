// H7 — useContentServer drives the store from the service, per workspace.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const startContentServer = vi.fn();
const stopContentServer = vi.fn();
const openKbInBrowser = vi.fn();
const getKbAuthUrl = vi.fn();
vi.mock("@/services/contentServer", () => ({
  startContentServer: (...a: unknown[]) => startContentServer(...a),
  stopContentServer: (...a: unknown[]) => stopContentServer(...a),
  openKbInBrowser: (...a: unknown[]) => openKbInBrowser(...a),
  getKbAuthUrl: (...a: unknown[]) => getKbAuthUrl(...a),
}));

import { useContentServer } from "./useContentServer";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

beforeEach(() => {
  startContentServer.mockReset();
  stopContentServer.mockReset();
  openKbInBrowser.mockReset();
  getKbAuthUrl.mockReset();
  getKbAuthUrl.mockResolvedValue("http://127.0.0.1:7/__auth?t=n");
  useContentServerStore.getState().reset();
  useWorkspaceStore.setState({ rootPath: "/ws" });
});

describe("useContentServer", () => {
  it("start → running with url/port", async () => {
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7 });
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.start();
    });
    expect(startContentServer).toHaveBeenCalledWith("/ws");
    const s = useContentServerStore.getState();
    expect(s.status).toBe("running");
    expect(s.port).toBe(7);
    expect(getKbAuthUrl).toHaveBeenCalledWith("/ws");
    expect(s.iframeUrl).toBe("http://127.0.0.1:7/__auth?t=n");
  });

  it("start without a workspace sets an error", async () => {
    useWorkspaceStore.setState({ rootPath: null });
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.start();
    });
    expect(startContentServer).not.toHaveBeenCalled();
    expect(useContentServerStore.getState().status).toBe("error");
  });

  it("start failure surfaces the error", async () => {
    startContentServer.mockRejectedValue(new Error("spawn boom"));
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.start();
    });
    expect(useContentServerStore.getState().error).toMatch(/spawn boom/);
  });

  it("stop calls the service and resets the store", async () => {
    stopContentServer.mockResolvedValue(undefined);
    useContentServerStore.getState().setRunning("http://127.0.0.1:7", 7);
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.stop();
    });
    expect(stopContentServer).toHaveBeenCalledWith("/ws");
    expect(useContentServerStore.getState().status).toBe("stopped");
  });

  it("openInBrowser delegates to the service", async () => {
    openKbInBrowser.mockResolvedValue("http://127.0.0.1:7/__auth?t=n");
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.openInBrowser();
    });
    expect(openKbInBrowser).toHaveBeenCalledWith("/ws");
  });
});
