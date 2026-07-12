// H7 — useContentServer drives the store from the service, per workspace.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const startContentServer = vi.fn();
const stopContentServer = vi.fn();
const openKbInBrowser = vi.fn();
const getKbAuthUrl = vi.fn();
const startSlidevPreview = vi.fn();
const exportSlidev = vi.fn();
vi.mock("@/services/contentServer", () => ({
  startContentServer: (...a: unknown[]) => startContentServer(...a),
  stopContentServer: (...a: unknown[]) => stopContentServer(...a),
  openKbInBrowser: (...a: unknown[]) => openKbInBrowser(...a),
  getKbAuthUrl: (...a: unknown[]) => getKbAuthUrl(...a),
  startSlidevPreview: (...a: unknown[]) => startSlidevPreview(...a),
  exportSlidev: (...a: unknown[]) => exportSlidev(...a),
}));

const openUrlMock = vi.fn();
const saveMock = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...a: unknown[]) => openUrlMock(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => saveMock(...a) }));

const findTabByIdMock = vi.fn();
vi.mock("@/services/navigation/activeDocument", () => ({ getActiveTabId: () => "t1" }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: () => ({ findTabById: (...a: unknown[]) => findTabByIdMock(...a) }) },
  tabFilePath: (t: { kind?: string; filePath?: string | null }) =>
    t?.kind === "document" ? (t.filePath ?? null) : null,
}));

type ExitPayload = { workspaceRoot: string; code: number | null };
let exitHandler: ((e: { payload: ExitPayload }) => void) | null = null;
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: (e: { payload: ExitPayload }) => void) => {
    if (event === "content-server:exited") exitHandler = cb;
    return Promise.resolve(unlisten);
  },
}));

import {
  useContentServer,
  shouldAutoRestart,
  slidevFormatFromPath,
  MAX_CONTENT_SERVER_RESTARTS,
} from "./useContentServer";
import { useContentServerStore } from "@/stores/contentServerStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

beforeEach(() => {
  startContentServer.mockReset();
  stopContentServer.mockReset();
  openKbInBrowser.mockReset();
  getKbAuthUrl.mockReset();
  getKbAuthUrl.mockResolvedValue("http://127.0.0.1:7/__auth?t=n");
  startSlidevPreview.mockReset();
  exportSlidev.mockReset();
  openUrlMock.mockReset();
  saveMock.mockReset();
  findTabByIdMock.mockReset().mockReturnValue({ kind: "document", filePath: "/ws/deck.md" });
  unlisten.mockReset();
  exitHandler = null;
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

  it("previewSlides starts a Slidev preview for the active deck and opens it", async () => {
    startSlidevPreview.mockResolvedValue("http://127.0.0.1:7/__auth?t=n&next=/slidev/");
    openUrlMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.previewSlides();
    });
    expect(startSlidevPreview).toHaveBeenCalledWith("/ws", "/ws/deck.md");
    expect(openUrlMock).toHaveBeenCalledWith("http://127.0.0.1:7/__auth?t=n&next=/slidev/");
    expect(useContentServerStore.getState().slidevDeckPath).toBe("/ws/deck.md");
  });

  it("exportSlides prompts for a path and exports the deck to PDF", async () => {
    saveMock.mockResolvedValue("/out/deck.pdf");
    exportSlidev.mockResolvedValue("/out/deck.pdf");
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.exportSlides();
    });
    expect(saveMock).toHaveBeenCalled();
    expect(exportSlidev).toHaveBeenCalledWith("/ws", "/ws/deck.md", "pdf", "/out/deck.pdf");
  });

  describe("slidevFormatFromPath", () => {
    it("derives the format from the output extension", () => {
      expect(slidevFormatFromPath("/o/deck.pdf")).toBe("pdf");
      expect(slidevFormatFromPath("/o/deck.PNG")).toBe("png");
      expect(slidevFormatFromPath("/o/deck.pptx")).toBe("pptx");
      expect(slidevFormatFromPath("/o/deck")).toBe("pdf");
    });
  });

  it("exportSlides derives PPTX format from the chosen path", async () => {
    saveMock.mockResolvedValue("/out/deck.pptx");
    exportSlidev.mockResolvedValue("/out/deck.pptx");
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.exportSlides();
    });
    expect(exportSlidev).toHaveBeenCalledWith("/ws", "/ws/deck.md", "pptx", "/out/deck.pptx");
  });

  it("exportSlides is a no-op when the save dialog is cancelled", async () => {
    saveMock.mockResolvedValue(null);
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.exportSlides();
    });
    expect(exportSlidev).not.toHaveBeenCalled();
  });

  it("previewSlides errors when there is no active deck", async () => {
    findTabByIdMock.mockReturnValue({ kind: "document", filePath: null });
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.previewSlides();
    });
    expect(startSlidevPreview).not.toHaveBeenCalled();
    expect(useContentServerStore.getState().status).toBe("error");
  });

  describe("shouldAutoRestart", () => {
    it("allows restarts below the cap and stops at it", () => {
      expect(shouldAutoRestart(0)).toBe(true);
      expect(shouldAutoRestart(MAX_CONTENT_SERVER_RESTARTS - 1)).toBe(true);
      expect(shouldAutoRestart(MAX_CONTENT_SERVER_RESTARTS)).toBe(false);
    });
  });

  it("auto-restarts the server on a crash event for the active workspace", async () => {
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7 });
    renderHook(() => useContentServer());
    expect(exitHandler).toBeTruthy();
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/ws", code: 1 } });
    });
    expect(startContentServer).toHaveBeenCalledWith("/ws");
  });

  it("ignores crash events for a different workspace", async () => {
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7 });
    renderHook(() => useContentServer());
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/other", code: 1 } });
    });
    expect(startContentServer).not.toHaveBeenCalled();
  });

  it("does not restart when a crash signal races a user-initiated stop", async () => {
    stopContentServer.mockResolvedValue(undefined);
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7 });
    const { result } = renderHook(() => useContentServer());
    await act(async () => {
      await result.current.stop();
    });
    // An exit event arriving right after stop must be suppressed (no restart).
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/ws", code: 0 } });
    });
    expect(startContentServer).not.toHaveBeenCalled();
    expect(useContentServerStore.getState().status).toBe("stopped");
  });

  it("gives up after the restart cap and surfaces an error", async () => {
    startContentServer.mockResolvedValue({ url: "http://127.0.0.1:7", port: 7 });
    renderHook(() => useContentServer());
    for (let i = 0; i < MAX_CONTENT_SERVER_RESTARTS; i++) {
      await act(async () => {
        exitHandler?.({ payload: { workspaceRoot: "/ws", code: 1 } });
      });
    }
    expect(startContentServer).toHaveBeenCalledTimes(MAX_CONTENT_SERVER_RESTARTS);
    startContentServer.mockClear();
    await act(async () => {
      exitHandler?.({ payload: { workspaceRoot: "/ws", code: 1 } });
    });
    expect(startContentServer).not.toHaveBeenCalled();
    expect(useContentServerStore.getState().status).toBe("error");
  });
});
