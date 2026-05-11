/**
 * Tests for useUpdateOperations
 *
 * Tests update check/download/install/restart operations and
 * the main-window operation handler.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock Tauri updater plugin
const mockCheck = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => mockCheck(...args),
}));

// Mock Tauri event emit
const mockEmit = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: (...args: unknown[]) => mockEmit(...args),
}));

// Mock Tauri app API
const mockGetVersion = vi.fn(() => Promise.resolve("1.0.0"));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: (...args: unknown[]) => mockGetVersion(...args),
}));

import { renderHook, act } from "@testing-library/react";
import { useUpdateStore } from "@/stores/updateStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  useUpdateOperations,
  useUpdateOperationHandler,
  clearPendingUpdate,
} from "./useUpdateOperations";

describe("useUpdateOperations", () => {
  beforeEach(() => {
    useUpdateStore.getState().reset();
    mockEmit.mockClear();
  });

  it("returns all operation functions", () => {
    const { result } = renderHook(() => useUpdateOperations());

    expect(result.current.checkForUpdates).toBeInstanceOf(Function);
    expect(result.current.downloadAndInstall).toBeInstanceOf(Function);
    expect(result.current.restartApp).toBeInstanceOf(Function);
    expect(result.current.skipVersion).toBeInstanceOf(Function);
    expect(result.current.requestState).toBeInstanceOf(Function);
  });

  // checkForUpdates now runs Tauri's check() inline in the calling window
  // (no cross-window emit) so the button stays responsive even when the
  // main window is destroyed. Regression for the "Check Now silently
  // does nothing when auto-update is on" report.
  it("checkForUpdates runs check() inline (no cross-window emit)", async () => {
    mockCheck.mockResolvedValue(null);
    const { result } = renderHook(() => useUpdateOperations());

    await act(async () => {
      await result.current.checkForUpdates();
    });

    expect(mockCheck).toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalledWith("update:request-check");
    // And the local store reflects the result.
    expect(useUpdateStore.getState().status).toBe("up-to-date");
  });

  // downloadAndInstall: when this window holds pendingUpdate, run inline.
  // Otherwise fall back to cross-window emit (covers the case where main
  // window auto-checked and Settings — which didn't run check — wants to
  // trigger the download).
  it("downloadAndInstall runs inline when pendingUpdate is local", async () => {
    const mockDownloadAndInstall = vi.fn(async () => {});
    useUpdateStore.getState().setPendingUpdate({
      downloadAndInstall: mockDownloadAndInstall,
    } as never);

    const { result } = renderHook(() => useUpdateOperations());

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(mockDownloadAndInstall).toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalledWith("update:request-download");
  });

  it("downloadAndInstall emits cross-window when no local pendingUpdate", async () => {
    useUpdateStore.getState().setPendingUpdate(null);
    const { result } = renderHook(() => useUpdateOperations());

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(mockEmit).toHaveBeenCalledWith("update:request-download");
  });

  it("restartApp emits restart event", async () => {
    const { result } = renderHook(() => useUpdateOperations());

    await act(async () => {
      await result.current.restartApp();
    });

    expect(mockEmit).toHaveBeenCalledWith("app:restart-for-update");
  });

  it("skipVersion saves version to settings and resets store", () => {
    const { result } = renderHook(() => useUpdateOperations());

    act(() => {
      result.current.skipVersion("2.0.0");
    });

    expect(useSettingsStore.getState().update.skipVersion).toBe("2.0.0");
    expect(useUpdateStore.getState().status).toBe("idle");
  });

  it("requestState emits request-state event", async () => {
    const { result } = renderHook(() => useUpdateOperations());

    await act(async () => {
      await result.current.requestState();
    });

    expect(mockEmit).toHaveBeenCalledWith("update:request-state");
  });
});

describe("useUpdateOperationHandler", () => {
  beforeEach(() => {
    useUpdateStore.getState().reset();
    mockCheck.mockReset();
    mockGetVersion.mockReset().mockResolvedValue("1.0.0");
  });

  it("returns doCheckForUpdates, doDownloadAndInstall, and EVENTS", () => {
    const { result } = renderHook(() => useUpdateOperationHandler());

    expect(result.current.doCheckForUpdates).toBeInstanceOf(Function);
    expect(result.current.doDownloadAndInstall).toBeInstanceOf(Function);
    expect(result.current.EVENTS).toBeDefined();
    expect(result.current.EVENTS.REQUEST_CHECK).toBe("update:request-check");
  });

  describe("doCheckForUpdates", () => {
    it("sets status to checking then available when update found", async () => {
      const mockUpdate = {
        version: "2.0.0",
        body: "New features",
        date: "2026-01-01",
      };
      mockCheck.mockResolvedValue(mockUpdate);

      const { result } = renderHook(() => useUpdateOperationHandler());

      let checkResult: boolean | undefined;
      await act(async () => {
        checkResult = await result.current.doCheckForUpdates();
      });

      expect(checkResult).toBe(true);
      expect(useUpdateStore.getState().status).toBe("available");
      expect(useUpdateStore.getState().updateInfo).toEqual({
        version: "2.0.0",
        notes: "New features",
        pubDate: "2026-01-01",
        currentVersion: "1.0.0",
      });
    });

    it("sets status to up-to-date when no update available", async () => {
      mockCheck.mockResolvedValue(null);

      const { result } = renderHook(() => useUpdateOperationHandler());

      let checkResult: boolean | undefined;
      await act(async () => {
        checkResult = await result.current.doCheckForUpdates();
      });

      expect(checkResult).toBe(false);
      expect(useUpdateStore.getState().status).toBe("up-to-date");
      expect(useUpdateStore.getState().pendingUpdate).toBeNull();
    });

    it("sets error state when check fails", async () => {
      mockCheck.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useUpdateOperationHandler());

      let checkResult: boolean | undefined;
      await act(async () => {
        checkResult = await result.current.doCheckForUpdates();
      });

      expect(checkResult).toBe(false);
      expect(useUpdateStore.getState().status).toBe("error");
      expect(useUpdateStore.getState().error).toBe("Network error");
    });

    it("handles non-Error thrown values", async () => {
      mockCheck.mockRejectedValue("string error");

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doCheckForUpdates();
      });

      expect(useUpdateStore.getState().error).toBe("Failed to check for updates");
    });

    it("handles update with null body and date", async () => {
      mockCheck.mockResolvedValue({
        version: "2.0.0",
        body: null,
        date: null,
      });

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doCheckForUpdates();
      });

      expect(useUpdateStore.getState().updateInfo?.notes).toBe("");
      expect(useUpdateStore.getState().updateInfo?.pubDate).toBe("");
    });

    it("clears dismissed flag when update found", async () => {
      // Pre-dismiss
      useUpdateStore.getState().dismiss();
      expect(useUpdateStore.getState().dismissed).toBe(true);

      mockCheck.mockResolvedValue({ version: "2.0.0", body: "", date: "" });

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doCheckForUpdates();
      });

      expect(useUpdateStore.getState().dismissed).toBe(false);
    });

    it("updates lastCheckTimestamp on successful check", async () => {
      mockCheck.mockResolvedValue(null);

      const { result } = renderHook(() => useUpdateOperationHandler());

      const before = Date.now();
      await act(async () => {
        await result.current.doCheckForUpdates();
      });
      const after = Date.now();

      const ts = useSettingsStore.getState().update.lastCheckTimestamp;
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe("doDownloadAndInstall", () => {
    it("sets error when no pending update", async () => {
      useUpdateStore.getState().setPendingUpdate(null);

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doDownloadAndInstall();
      });

      expect(useUpdateStore.getState().error).toBe("No update available to download");
    });

    it("downloads and tracks progress", async () => {
      const mockDownloadAndInstall = vi.fn(async (onProgress) => {
        // Simulate progress events
        onProgress({ event: "Started", data: { contentLength: 1000 } });
        onProgress({ event: "Progress", data: { chunkLength: 500 } });
        onProgress({ event: "Progress", data: { chunkLength: 500 } });
        onProgress({ event: "Finished", data: {} });
      });

      useUpdateStore.getState().setPendingUpdate({
        downloadAndInstall: mockDownloadAndInstall,
      } as never);

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doDownloadAndInstall();
      });

      expect(useUpdateStore.getState().status).toBe("ready");
      expect(mockDownloadAndInstall).toHaveBeenCalled();
    });

    it("sets error state when download fails", async () => {
      const mockDownloadAndInstall = vi.fn(async () => {
        throw new Error("Download failed");
      });

      useUpdateStore.getState().setPendingUpdate({
        downloadAndInstall: mockDownloadAndInstall,
      } as never);

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doDownloadAndInstall();
      });

      expect(useUpdateStore.getState().status).toBe("error");
      expect(useUpdateStore.getState().error).toBe("Download failed");
    });

    it("handles non-Error thrown values during download", async () => {
      const mockDownloadAndInstall = vi.fn(async () => {
        throw "unknown error";
      });

      useUpdateStore.getState().setPendingUpdate({
        downloadAndInstall: mockDownloadAndInstall,
      } as never);

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doDownloadAndInstall();
      });

      expect(useUpdateStore.getState().error).toBe("Failed to download update");
    });

    it("handles Started event with null contentLength", async () => {
      const mockDownloadAndInstall = vi.fn(async (onProgress) => {
        onProgress({ event: "Started", data: { contentLength: null } });
        onProgress({ event: "Finished", data: {} });
      });

      useUpdateStore.getState().setPendingUpdate({
        downloadAndInstall: mockDownloadAndInstall,
      } as never);

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doDownloadAndInstall();
      });

      expect(useUpdateStore.getState().status).toBe("ready");
    });
  });
});

describe("clearPendingUpdate", () => {
  it("sets pending update to null", () => {
    useUpdateStore.getState().setPendingUpdate({ version: "2.0.0" } as never);
    expect(useUpdateStore.getState().pendingUpdate).not.toBeNull();

    clearPendingUpdate();

    expect(useUpdateStore.getState().pendingUpdate).toBeNull();
  });
});
