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
import { useMcpStore } from "@/stores/mcpStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  useUpdateOperations,
  useUpdateOperationHandler,
  clearPendingUpdate,
} from "./useUpdateOperations";

describe("useUpdateOperations", () => {
  beforeEach(() => {
    useMcpStore.getState().resetUpdate();
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
    expect(useMcpStore.getState().update.status).toBe("up-to-date");
  });

  // downloadAndInstall: when this window holds pendingUpdate, run inline.
  it("downloadAndInstall runs inline when pendingUpdate is local", async () => {
    const mockDownloadAndInstall = vi.fn(async () => {});
    useMcpStore.getState().setPendingUpdate({
      downloadAndInstall: mockDownloadAndInstall,
    } as never);

    const { result } = renderHook(() => useUpdateOperations());

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(mockDownloadAndInstall).toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalledWith("update:request-download");
  });

  // Regression for the audit's "silent no-op" finding: previously when no
  // local pendingUpdate existed we emitted update:request-download and
  // hoped the main window listener would handle it. If main was destroyed
  // (the same scenario the Check Now fix originally targeted), the click
  // vanished. Now downloadAndInstall re-checks locally and downloads
  // self-sufficiently — no cross-window dependency for the user-visible
  // download operation.
  it("downloadAndInstall re-checks locally when no pendingUpdate (no cross-window emit)", async () => {
    useMcpStore.getState().setPendingUpdate(null);

    const mockDownloadAndInstall = vi.fn(async () => {});
    // mockCheck returns an Update on the re-check — runUpdateCheck stores it.
    mockCheck.mockResolvedValue({
      version: "9.9.9",
      body: "notes",
      date: "2026-05-11",
      downloadAndInstall: mockDownloadAndInstall,
    });

    const { result } = renderHook(() => useUpdateOperations());

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(mockCheck).toHaveBeenCalled();
    expect(mockDownloadAndInstall).toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalledWith("update:request-download");
  });

  it("downloadAndInstall is a no-op when re-check finds no update", async () => {
    useMcpStore.getState().setPendingUpdate(null);
    mockCheck.mockResolvedValue(null); // no update available

    const { result } = renderHook(() => useUpdateOperations());

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(mockCheck).toHaveBeenCalled();
    // Status from the re-check propagates; no broken download attempt.
    expect(useMcpStore.getState().update.status).toBe("up-to-date");
    expect(mockEmit).not.toHaveBeenCalledWith("update:request-download");
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
    expect(useMcpStore.getState().update.status).toBe("idle");
  });

  it("requestState emits request-state event", async () => {
    const { result } = renderHook(() => useUpdateOperations());

    await act(async () => {
      await result.current.requestState();
    });

    expect(mockEmit).toHaveBeenCalledWith("update:request-state");
  });

  // Regression for the v0.7.11 freeze: spam-clicking "Check Now" while a
  // check was in flight spawned parallel `check()` requests. Each broadcast
  // back to the other window via useUpdateSync, which fed main's retry
  // effect with extra "checking → error" transitions. Single-flight makes
  // every concurrent caller share the in-flight promise.
  it("checkForUpdates is single-flight — overlapping callers reuse the in-flight check", async () => {
    let resolveCheck: ((value: unknown) => void) | undefined;
    mockCheck.mockReset();
    mockCheck.mockImplementation(
      () => new Promise((r) => { resolveCheck = r; }),
    );

    const { result } = renderHook(() => useUpdateOperations());

    let firstDone = false;
    let secondDone = false;
    await act(async () => {
      const first = result.current.checkForUpdates().then(() => { firstDone = true; });
      const second = result.current.checkForUpdates().then(() => { secondDone = true; });
      // Allow microtasks to settle so the second call enters runUpdateCheck
      // and hits the single-flight guard.
      await Promise.resolve();
      expect(mockCheck).toHaveBeenCalledTimes(1);
      expect(firstDone).toBe(false);
      expect(secondDone).toBe(false);
      resolveCheck?.(null);
      await Promise.all([first, second]);
    });

    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(firstDone).toBe(true);
    expect(secondDone).toBe(true);
  });

  // Same single-flight guarantee for the download side. The Tauri
  // pendingUpdate.downloadAndInstall is not safe to call twice on the
  // same Update resource — overlapping callers (e.g., manual click while
  // the auto-download effect fires) must share one in-flight promise.
  it("downloadAndInstall is single-flight — overlapping callers reuse the in-flight download", async () => {
    let resolveDownload: (() => void) | undefined;
    const mockDownloadAndInstall = vi.fn(
      () => new Promise<void>((r) => { resolveDownload = r; }),
    );
    useMcpStore.getState().setPendingUpdate({
      downloadAndInstall: mockDownloadAndInstall,
    } as never);

    const { result } = renderHook(() => useUpdateOperations());

    let firstDone = false;
    let secondDone = false;
    await act(async () => {
      const first = result.current.downloadAndInstall().then(() => { firstDone = true; });
      const second = result.current.downloadAndInstall().then(() => { secondDone = true; });
      // Let microtasks settle so the second call enters runUpdateDownload
      // and hits the inFlight.download gate.
      await Promise.resolve();
      await Promise.resolve();
      expect(mockDownloadAndInstall).toHaveBeenCalledTimes(1);
      expect(firstDone).toBe(false);
      expect(secondDone).toBe(false);
      resolveDownload?.();
      await Promise.all([first, second]);
    });

    expect(mockDownloadAndInstall).toHaveBeenCalledTimes(1);
    expect(firstDone).toBe(true);
    expect(secondDone).toBe(true);
  });
});

describe("useUpdateOperationHandler", () => {
  beforeEach(() => {
    useMcpStore.getState().resetUpdate();
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
      expect(useMcpStore.getState().update.status).toBe("available");
      expect(useMcpStore.getState().update.updateInfo).toEqual({
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
      expect(useMcpStore.getState().update.status).toBe("up-to-date");
      expect(useMcpStore.getState().update.pendingUpdate).toBeNull();
    });

    it("sets error state when check fails", async () => {
      mockCheck.mockRejectedValue(new Error("Network error"));

      const { result } = renderHook(() => useUpdateOperationHandler());

      let checkResult: boolean | undefined;
      await act(async () => {
        checkResult = await result.current.doCheckForUpdates();
      });

      expect(checkResult).toBe(false);
      expect(useMcpStore.getState().update.status).toBe("error");
      expect(useMcpStore.getState().update.error).toBe("Network error");
    });

    it("handles non-Error thrown values", async () => {
      mockCheck.mockRejectedValue("string error");

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doCheckForUpdates();
      });

      expect(useMcpStore.getState().update.error).toBe("Failed to check for updates");
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

      expect(useMcpStore.getState().update.updateInfo?.notes).toBe("");
      expect(useMcpStore.getState().update.updateInfo?.pubDate).toBe("");
    });

    it("clears dismissed flag when update found", async () => {
      // Pre-dismiss
      useMcpStore.getState().dismissUpdate();
      expect(useMcpStore.getState().update.dismissed).toBe(true);

      mockCheck.mockResolvedValue({ version: "2.0.0", body: "", date: "" });

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doCheckForUpdates();
      });

      expect(useMcpStore.getState().update.dismissed).toBe(false);
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
      useMcpStore.getState().setPendingUpdate(null);

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doDownloadAndInstall();
      });

      expect(useMcpStore.getState().update.error).toBe("No update available to download");
    });

    it("downloads and tracks progress", async () => {
      const mockDownloadAndInstall = vi.fn(async (onProgress) => {
        // Simulate progress events
        onProgress({ event: "Started", data: { contentLength: 1000 } });
        onProgress({ event: "Progress", data: { chunkLength: 500 } });
        onProgress({ event: "Progress", data: { chunkLength: 500 } });
        onProgress({ event: "Finished", data: {} });
      });

      useMcpStore.getState().setPendingUpdate({
        downloadAndInstall: mockDownloadAndInstall,
      } as never);

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doDownloadAndInstall();
      });

      expect(useMcpStore.getState().update.status).toBe("ready");
      expect(mockDownloadAndInstall).toHaveBeenCalled();
    });

    it("sets error state when download fails", async () => {
      const mockDownloadAndInstall = vi.fn(async () => {
        throw new Error("Download failed");
      });

      useMcpStore.getState().setPendingUpdate({
        downloadAndInstall: mockDownloadAndInstall,
      } as never);

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doDownloadAndInstall();
      });

      expect(useMcpStore.getState().update.status).toBe("error");
      expect(useMcpStore.getState().update.error).toBe("Download failed");
    });

    it("handles non-Error thrown values during download", async () => {
      const mockDownloadAndInstall = vi.fn(async () => {
        throw "unknown error";
      });

      useMcpStore.getState().setPendingUpdate({
        downloadAndInstall: mockDownloadAndInstall,
      } as never);

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doDownloadAndInstall();
      });

      expect(useMcpStore.getState().update.error).toBe("Failed to download update");
    });

    it("handles Started event with null contentLength", async () => {
      const mockDownloadAndInstall = vi.fn(async (onProgress) => {
        onProgress({ event: "Started", data: { contentLength: null } });
        onProgress({ event: "Finished", data: {} });
      });

      useMcpStore.getState().setPendingUpdate({
        downloadAndInstall: mockDownloadAndInstall,
      } as never);

      const { result } = renderHook(() => useUpdateOperationHandler());

      await act(async () => {
        await result.current.doDownloadAndInstall();
      });

      expect(useMcpStore.getState().update.status).toBe("ready");
    });
  });
});

describe("clearPendingUpdate", () => {
  it("sets pending update to null", () => {
    useMcpStore.getState().setPendingUpdate({ version: "2.0.0" } as never);
    expect(useMcpStore.getState().update.pendingUpdate).not.toBeNull();

    clearPendingUpdate();

    expect(useMcpStore.getState().update.pendingUpdate).toBeNull();
  });
});
