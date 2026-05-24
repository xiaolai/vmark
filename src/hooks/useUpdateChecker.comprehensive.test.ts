/**
 * Comprehensive tests for useUpdateChecker hook
 *
 * Extends the existing shouldCheckNow tests with hook-level tests:
 * event listeners, auto-download, skip version, retry logic, toast notifications.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// --- Mocks ---

const listenHandlers = new Map<string, (event?: unknown) => void>();
const mockListen = vi.fn((eventName: string, handler: (event?: unknown) => void) => {
  listenHandlers.set(eventName, handler);
  return Promise.resolve(() => {
    listenHandlers.delete(eventName);
  });
});
const mockEmit = vi.fn(() => Promise.resolve());

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...(args as [string, (event?: unknown) => void])),
  emit: (...args: unknown[]) => mockEmit(...args),
}));

const mockAsk = vi.fn(() => Promise.resolve(true));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => mockAsk(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockDoCheckForUpdates = vi.fn(() => Promise.resolve());
const mockDoDownloadAndInstall = vi.fn(() => Promise.resolve());
const mockClearPendingUpdate = vi.fn();

vi.mock("./useUpdateOperations", () => ({
  useUpdateOperationHandler: () => ({
    doCheckForUpdates: mockDoCheckForUpdates,
    doDownloadAndInstall: mockDoDownloadAndInstall,
    EVENTS: {
      REQUEST_CHECK: "update:request-check",
      REQUEST_DOWNLOAD: "update:request-download",
      REQUEST_RESTART: "app:restart-for-update",
      REQUEST_STATE: "update:request-state",
    },
  }),
  clearPendingUpdate: () => mockClearPendingUpdate(),
}));

const mockRestartWithHotExit = vi.fn(() => Promise.resolve());
vi.mock("@/services/persistence/hotExit/restartWithHotExit", () => ({
  restartWithHotExit: () => mockRestartWithHotExit(),
}));

vi.mock("@/utils/debug", () => ({
  updateCheckerLog: vi.fn(),
}));

vi.mock("@/utils/safeUnlisten", () => ({
  safeUnlistenAsync: vi.fn(),
}));

import { useUpdateChecker, shouldCheckNow } from "./useUpdateChecker";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUpdateStore } from "@/stores/updateStore";
import { useDocumentStore } from "@/stores/documentStore";

const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_WEEK = 7 * ONE_DAY;

describe("shouldCheckNow — extended edge cases", () => {
  it("returns true for unknown frequency with null timestamp (falls through to null check)", () => {
    // When lastCheckTimestamp is null, shouldCheckNow returns true before reaching
    // the frequency-specific branches — so unknown frequency with null = true
    expect(shouldCheckNow(true, "quarterly", null)).toBe(true);
  });

  it("returns false for unknown frequency with recent timestamp", () => {
    // With a recent timestamp, unknown frequency falls through all branches to return false
    expect(shouldCheckNow(true, "quarterly", Date.now())).toBe(false);
  });

  it("returns true for daily when exactly one day has passed", () => {
    const exactlyOneDay = Date.now() - ONE_DAY;
    expect(shouldCheckNow(true, "daily", exactlyOneDay)).toBe(true);
  });

  it("returns true for weekly when exactly one week has passed", () => {
    const exactlyOneWeek = Date.now() - ONE_WEEK;
    expect(shouldCheckNow(true, "weekly", exactlyOneWeek)).toBe(true);
  });
});

describe("useUpdateChecker hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listenHandlers.clear();

    // Reset stores to defaults
    useUpdateStore.getState().reset();
    useSettingsStore.getState().updateUpdateSetting("autoCheckEnabled", true);
    useSettingsStore.getState().updateUpdateSetting("checkFrequency", "startup");
    useSettingsStore.getState().updateUpdateSetting("lastCheckTimestamp", null);
    useSettingsStore.getState().updateUpdateSetting("skipVersion", null);
    useSettingsStore.getState().updateUpdateSetting("autoDownload", false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks for updates on startup after delay", async () => {
    renderHook(() => useUpdateChecker());

    // Should not check immediately
    expect(mockDoCheckForUpdates).not.toHaveBeenCalled();

    // Advance past the startup delay (2s)
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(mockDoCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it("does not check on startup when autoCheck is disabled", async () => {
    useSettingsStore.getState().updateUpdateSetting("autoCheckEnabled", false);

    renderHook(() => useUpdateChecker());

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockDoCheckForUpdates).not.toHaveBeenCalled();
  });

  it("does not check on startup when frequency is manual", async () => {
    useSettingsStore.getState().updateUpdateSetting("checkFrequency", "manual");

    renderHook(() => useUpdateChecker());

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockDoCheckForUpdates).not.toHaveBeenCalled();
  });

  it("registers event listeners for cross-window communication", () => {
    renderHook(() => useUpdateChecker());

    expect(mockListen).toHaveBeenCalledWith("update:request-check", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("update:request-download", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("update:request-state", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("app:restart-for-update", expect.any(Function));
  });

  it("handles check request from other window", async () => {
    renderHook(() => useUpdateChecker());

    const handler = listenHandlers.get("update:request-check");
    expect(handler).toBeDefined();

    await act(async () => {
      handler!();
    });

    expect(mockDoCheckForUpdates).toHaveBeenCalled();
  });

  it("handles download request from other window", async () => {
    renderHook(() => useUpdateChecker());

    const handler = listenHandlers.get("update:request-download");
    expect(handler).toBeDefined();

    await act(async () => {
      handler!();
    });

    expect(mockDoDownloadAndInstall).toHaveBeenCalled();
  });

  it("broadcasts state on state request", async () => {
    renderHook(() => useUpdateChecker());

    const handler = listenHandlers.get("update:request-state");
    expect(handler).toBeDefined();

    await act(async () => {
      handler!();
    });

    expect(mockEmit).toHaveBeenCalledWith(
      "update:state-changed",
      expect.objectContaining({ status: expect.any(String) })
    );
  });

  it("auto-dismisses when update version matches skipVersion", async () => {
    useSettingsStore.getState().updateUpdateSetting("skipVersion", "2.0.0");

    renderHook(() => useUpdateChecker());

    // Simulate update available
    await act(async () => {
      useUpdateStore.getState().setStatus("available");
      useUpdateStore.getState().setUpdateInfo({
        version: "2.0.0",
        notes: "test",
        pubDate: "2025-01-01",
        currentVersion: "1.0.0",
      });
    });

    expect(useUpdateStore.getState().dismissed).toBe(true);
    expect(mockClearPendingUpdate).toHaveBeenCalled();
  });

  it("auto-downloads when enabled and update available", async () => {
    useSettingsStore.getState().updateUpdateSetting("autoDownload", true);

    renderHook(() => useUpdateChecker());

    await act(async () => {
      useUpdateStore.getState().setPendingUpdate({} as never);
      useUpdateStore.getState().setStatus("available");
      useUpdateStore.getState().setUpdateInfo({
        version: "2.0.0",
        notes: "test",
        pubDate: "2025-01-01",
        currentVersion: "1.0.0",
      });
    });

    expect(mockDoDownloadAndInstall).toHaveBeenCalled();
  });

  // Regression: bidirectional state sync means main can receive
  // status="available" from another window's broadcast WITHOUT receiving
  // pendingUpdate (Tauri Update is window-local, not serializable). Auto-
  // download must guard on local pendingUpdate or it fires against null
  // and produces a confusing "No update available to download" error
  // that then broadcasts back, clobbering the originating window's state.
  it("does not auto-download when status='available' but no local pendingUpdate", async () => {
    useSettingsStore.getState().updateUpdateSetting("autoDownload", true);

    renderHook(() => useUpdateChecker());

    await act(async () => {
      // Simulate receiving "available" from a remote broadcast — no local
      // pendingUpdate.
      useUpdateStore.getState().setPendingUpdate(null);
      useUpdateStore.getState().setStatus("available");
      useUpdateStore.getState().setUpdateInfo({
        version: "2.0.0",
        notes: "test",
        pubDate: "2025-01-01",
        currentVersion: "1.0.0",
      });
    });

    expect(mockDoDownloadAndInstall).not.toHaveBeenCalled();
  });

  it("does not auto-download skipped versions", async () => {
    useSettingsStore.getState().updateUpdateSetting("autoDownload", true);
    useSettingsStore.getState().updateUpdateSetting("skipVersion", "2.0.0");

    renderHook(() => useUpdateChecker());

    await act(async () => {
      useUpdateStore.getState().setPendingUpdate({} as never);
      useUpdateStore.getState().setStatus("available");
      useUpdateStore.getState().setUpdateInfo({
        version: "2.0.0",
        notes: "test",
        pubDate: "2025-01-01",
        currentVersion: "1.0.0",
      });
    });

    // auto-download should not fire because version is skipped
    expect(mockDoDownloadAndInstall).not.toHaveBeenCalled();
  });

  it("handles restart request with no dirty tabs", async () => {
    vi.spyOn(useDocumentStore.getState(), "getAllDirtyDocuments").mockReturnValue([]);

    renderHook(() => useUpdateChecker());

    const handler = listenHandlers.get("app:restart-for-update");
    expect(handler).toBeDefined();

    await act(async () => {
      handler!();
      // Flush promises
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRestartWithHotExit).toHaveBeenCalled();
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it("handles restart request with dirty tabs — user confirms", async () => {
    vi.spyOn(useDocumentStore.getState(), "getAllDirtyDocuments").mockReturnValue([
      { tabId: "t1", content: "dirty" },
    ] as never);
    mockAsk.mockResolvedValue(true);

    renderHook(() => useUpdateChecker());

    const handler = listenHandlers.get("app:restart-for-update");

    await act(async () => {
      handler!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockAsk).toHaveBeenCalled();
    expect(mockRestartWithHotExit).toHaveBeenCalled();
  });

  it("shows ready toast when status changes to ready with update info", async () => {
    const { toast } = await import("sonner");

    renderHook(() => useUpdateChecker());

    // First set to checking, then to ready
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });

    await act(async () => {
      useUpdateStore.getState().setStatus("ready");
      useUpdateStore.getState().setUpdateInfo({
        version: "3.0.0",
        notes: "test",
        pubDate: "2025-01-01",
        currentVersion: "1.0.0",
      });
    });

    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("3.0.0"),
      expect.any(Object)
    );
  });

  it("shows up-to-date toast only for manual check", async () => {
    const { toast } = await import("sonner");

    renderHook(() => useUpdateChecker());

    // Simulate manual check request
    const handler = listenHandlers.get("update:request-check");
    await act(async () => {
      handler!();
    });

    // isManualCheck is now true — simulate checking -> up-to-date
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });

    await act(async () => {
      useUpdateStore.getState().setStatus("up-to-date");
    });

    expect(toast.success).toHaveBeenCalledWith(
      "You're up to date!",
      expect.any(Object)
    );
  });

  it("does not show up-to-date toast for automatic check", async () => {
    const { toast } = await import("sonner");

    renderHook(() => useUpdateChecker());

    // Simulate automatic check -> up-to-date (isManualCheck stays false)
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });

    await act(async () => {
      useUpdateStore.getState().setStatus("up-to-date");
    });

    // toast should NOT be called for automatic checks
    expect(toast.success).not.toHaveBeenCalledWith(
      "You're up to date!",
      expect.any(Object)
    );
  });

  it("resets retry count when status becomes up-to-date", async () => {
    renderHook(() => useUpdateChecker());

    // Simulate a successful check cycle: checking -> up-to-date
    // This exercises the retry count reset path (retryCount = 0 on success)
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });

    await act(async () => {
      useUpdateStore.getState().setStatus("up-to-date");
    });

    // Status should be up-to-date; no errors or retries
    expect(useUpdateStore.getState().status).toBe("up-to-date");
  });

  it("resets auto-download flag when status goes back to idle", async () => {
    useSettingsStore.getState().updateUpdateSetting("autoDownload", true);

    renderHook(() => useUpdateChecker());

    // Trigger auto-download
    await act(async () => {
      useUpdateStore.getState().setPendingUpdate({} as never);
      useUpdateStore.getState().setStatus("available");
      useUpdateStore.getState().setUpdateInfo({
        version: "2.0.0",
        notes: "test",
        pubDate: "2025-01-01",
        currentVersion: "1.0.0",
      });
    });

    expect(mockDoDownloadAndInstall).toHaveBeenCalledTimes(1);

    // Reset to idle
    await act(async () => {
      useUpdateStore.getState().setStatus("idle");
    });

    // Trigger again — should auto-download again since flag was reset
    await act(async () => {
      useUpdateStore.getState().setPendingUpdate({} as never);
      useUpdateStore.getState().setStatus("available");
      useUpdateStore.getState().setUpdateInfo({
        version: "2.1.0",
        notes: "test",
        pubDate: "2025-01-01",
        currentVersion: "1.0.0",
      });
    });

    expect(mockDoDownloadAndInstall).toHaveBeenCalledTimes(2);
  });

  it("handles restart request error gracefully", async () => {
    vi.spyOn(useDocumentStore.getState(), "getAllDirtyDocuments").mockReturnValue([]);
    mockRestartWithHotExit.mockRejectedValue(new Error("restart failed"));

    renderHook(() => useUpdateChecker());

    const handler = listenHandlers.get("app:restart-for-update");

    await act(async () => {
      handler!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should emit restart-cancelled on error
    expect(mockEmit).toHaveBeenCalledWith("update:restart-cancelled");
  });

  it("handles restart request with dirty tabs — user cancels", async () => {
    vi.spyOn(useDocumentStore.getState(), "getAllDirtyDocuments").mockReturnValue([
      { tabId: "t1", content: "dirty" },
    ] as never);
    mockAsk.mockResolvedValue(false);

    renderHook(() => useUpdateChecker());

    const handler = listenHandlers.get("app:restart-for-update");

    await act(async () => {
      handler!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRestartWithHotExit).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith("update:restart-cancelled");
  });

  it("skips startup check when hasChecked is already true (second render guard)", async () => {
    // On first render with startup frequency, shouldCheckNow returns true → sets hasChecked.current=true
    // and schedules a 2s timer. Changing a dependency triggers effect cleanup (clears timer) and re-run.
    // The re-run hits the hasChecked.current guard (line 99) and returns early — no new timer is scheduled.
    renderHook(() => useUpdateChecker());

    // First render: hasChecked.current is false → timer is scheduled, hasChecked.current = true
    expect(mockDoCheckForUpdates).not.toHaveBeenCalled();

    // Change lastCheckTimestamp — triggers effect cleanup (cancels timer) and re-run
    // Re-run: hasChecked.current is now true → line 99 fires → returns early (no new timer)
    await act(async () => {
      useSettingsStore.getState().updateUpdateSetting("lastCheckTimestamp", Date.now());
    });

    // Advance time past startup delay — timer was cancelled by cleanup, no new timer was set
    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
    });

    // No check happened because the timer was cancelled and the early return prevented a new one
    expect(mockDoCheckForUpdates).toHaveBeenCalledTimes(0);
  });

  it("handles doCheckForUpdates rejection in startup timer (catch path)", async () => {
    mockDoCheckForUpdates.mockRejectedValueOnce(new Error("network error"));

    renderHook(() => useUpdateChecker());

    await act(async () => {
      vi.advanceTimersByTime(2100);
      // Flush the rejected promise
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should not throw; error is caught and logged
    expect(mockDoCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it("retries on error after checking (retry logic with backoff)", async () => {
    renderHook(() => useUpdateChecker());

    // Transition: idle -> checking -> error (triggers retry)
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });

    await act(async () => {
      useUpdateStore.getState().setStatus("error");
    });

    // Retry timer fires after BASE_RETRY_DELAY_MS (5000ms)
    await act(async () => {
      vi.advanceTimersByTime(5100);
      await Promise.resolve();
    });

    // doCheckForUpdates called by retry
    expect(mockDoCheckForUpdates).toHaveBeenCalled();
  });

  it("retries up to MAX_RETRIES times then gives up", async () => {
    renderHook(() => useUpdateChecker());

    // Fire the startup timer (2000ms) — this is what arms the retry
    // chain in the post-fix code path. Manual transitions before this
    // point do not start a retry chain on purpose.
    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
    });
    mockDoCheckForUpdates.mockClear();

    // First retry: checking -> error
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });
    await act(async () => {
      useUpdateStore.getState().setStatus("error");
    });
    await act(async () => {
      vi.advanceTimersByTime(5100);
      await Promise.resolve();
    });

    // Second retry: checking -> error
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });
    await act(async () => {
      useUpdateStore.getState().setStatus("error");
    });
    await act(async () => {
      vi.advanceTimersByTime(10100);
      await Promise.resolve();
    });

    // Third retry: checking -> error (maxed out)
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });
    await act(async () => {
      useUpdateStore.getState().setStatus("error");
    });
    await act(async () => {
      vi.advanceTimersByTime(20100);
      await Promise.resolve();
    });

    // After max retries: checking -> error — no more retries
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });
    await act(async () => {
      useUpdateStore.getState().setStatus("error");
    });

    // Should stop scheduling retries (max 3 reached); ensure no extra timers fire
    const callsBefore = mockDoCheckForUpdates.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(40100);
      await Promise.resolve();
    });
    expect(mockDoCheckForUpdates.mock.calls.length).toBe(callsBefore);
  });

  // Regression for the cancelled-timer / out-of-band-manual-check window:
  // retryChainActiveRef must NOT be armed until the startup timer's
  // callback actually runs. If the chain were armed in the effect body,
  // a checking → error transition during the 2-second startup delay
  // (e.g., user clicked Check Now in Settings before auto-check fires,
  // or the component unmounted before the timer ran) would be
  // misclassified as part of an auto-chain and surface retries/toast.
  it("does not arm the retry chain until the startup timer fires", async () => {
    const { toast } = await import("sonner");
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    mockDoCheckForUpdates.mockClear();

    renderHook(() => useUpdateChecker());

    // Stay BELOW the 2000ms startup delay — the auto-chain must not be
    // armed yet.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Simulate an out-of-band manual check (e.g., from Settings) that
    // fails immediately.
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });
    await act(async () => {
      useUpdateStore.getState().setStatus("error");
    });

    // Advance another sub-startup interval. We don't cross 2000ms total,
    // so the startup timer can't fire and any retry timer would still
    // be 5000ms away — neither should have been scheduled in the first
    // place because the chain wasn't active.
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(mockDoCheckForUpdates).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: "update-retries-exhausted" }),
    );
  });

  // Regression for v0.7.11 freeze: after the auto-retry chain exhausts,
  // every later `checking → error` transition (typically a Settings-window
  // click broadcasting through useUpdateListener) used to re-fire the
  // pinned "retries exhausted" toast — which then stacked because the
  // toast had no stable id. With retryChainActiveRef cleared on exhaustion
  // and a stable id passed to sonner, the toast fires exactly once per
  // real chain and is deduplicated in place if it ever did re-fire.
  it("fires retries-exhausted toast at most once per chain, with a stable id", async () => {
    const { toast } = await import("sonner");
    (toast.error as ReturnType<typeof vi.fn>).mockClear();

    renderHook(() => useUpdateChecker());

    // Fire the startup timer first — that arms the chain (post-fix the
    // chain isn't active just by mounting; the timer's callback sets it).
    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
    });

    // Drive the chain to exhaustion: 3 retries scheduled, then the 4th
    // checking→error transition is the exhaustion event.
    const driveCheckingToError = async (advanceMs: number) => {
      await act(async () => {
        useUpdateStore.getState().setStatus("checking");
      });
      await act(async () => {
        useUpdateStore.getState().setStatus("error");
      });
      await act(async () => {
        vi.advanceTimersByTime(advanceMs);
        await Promise.resolve();
      });
    };

    await driveCheckingToError(5100);   // retry 1 (count 0 -> 1)
    await driveCheckingToError(10100);  // retry 2 (count 1 -> 2)
    await driveCheckingToError(20100);  // retry 3 (count 2 -> 3)
    // 4th transition is the exhaustion event (count 3, NOT < MAX) — fires toast.
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });
    await act(async () => {
      useUpdateStore.getState().setStatus("error");
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: "update-retries-exhausted" }),
    );

    // Subsequent transitions (e.g., user clicks "Check Now" in Settings,
    // its broadcast flips main's status checking→error) must NOT fire any
    // additional retry-exhausted toast — chain is no longer active.
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });
    await act(async () => {
      useUpdateStore.getState().setStatus("error");
    });
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });
    await act(async () => {
      useUpdateStore.getState().setStatus("error");
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("does not retry when autoCheckEnabled is false", async () => {
    useSettingsStore.getState().updateUpdateSetting("autoCheckEnabled", false);

    renderHook(() => useUpdateChecker());

    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });
    await act(async () => {
      useUpdateStore.getState().setStatus("error");
    });

    const callsBefore = mockDoCheckForUpdates.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    expect(mockDoCheckForUpdates.mock.calls.length).toBe(callsBefore);
  });

  it("handles doCheckForUpdates rejection in retry (retry catch path)", async () => {
    mockDoCheckForUpdates.mockRejectedValueOnce(new Error("retry network error"));

    renderHook(() => useUpdateChecker());

    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });
    await act(async () => {
      useUpdateStore.getState().setStatus("error");
    });
    await act(async () => {
      vi.advanceTimersByTime(5100);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should not throw; retry error is caught and logged
    expect(mockDoCheckForUpdates).toHaveBeenCalled();
  });

  it("handles doDownloadAndInstall rejection in auto-download (catch path)", async () => {
    useSettingsStore.getState().updateUpdateSetting("autoDownload", true);
    mockDoDownloadAndInstall.mockRejectedValueOnce(new Error("download failed"));

    renderHook(() => useUpdateChecker());

    await act(async () => {
      useUpdateStore.getState().setPendingUpdate({} as never);
      useUpdateStore.getState().setStatus("available");
      useUpdateStore.getState().setUpdateInfo({
        version: "2.0.0",
        notes: "test",
        pubDate: "2025-01-01",
        currentVersion: "1.0.0",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should not throw; error is caught and logged
    expect(mockDoDownloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it("handles doCheckForUpdates rejection in REQUEST_CHECK listener (catch path)", async () => {
    mockDoCheckForUpdates.mockRejectedValueOnce(new Error("check failed"));

    renderHook(() => useUpdateChecker());

    const handler = listenHandlers.get("update:request-check");
    await act(async () => {
      handler!();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should not throw; error is caught and logged
    expect(mockDoCheckForUpdates).toHaveBeenCalled();
  });

  it("handles doDownloadAndInstall rejection in REQUEST_DOWNLOAD listener (catch path)", async () => {
    mockDoDownloadAndInstall.mockRejectedValueOnce(new Error("download failed"));

    renderHook(() => useUpdateChecker());

    const handler = listenHandlers.get("update:request-download");
    await act(async () => {
      handler!();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should not throw; error is caught and logged
    expect(mockDoDownloadAndInstall).toHaveBeenCalled();
  });

  it("handles emit rejection in REQUEST_STATE listener (catch path)", async () => {
    mockEmit.mockRejectedValueOnce(new Error("emit failed"));

    renderHook(() => useUpdateChecker());

    const handler = listenHandlers.get("update:request-state");
    await act(async () => {
      handler!();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should not throw; error is caught and logged
    expect(mockEmit).toHaveBeenCalledWith(
      "update:state-changed",
      expect.any(Object)
    );
  });

  it("handles emit rejection in restart error path (nested catch path)", async () => {
    vi.spyOn(useDocumentStore.getState(), "getAllDirtyDocuments").mockReturnValue([]);
    mockRestartWithHotExit.mockRejectedValue(new Error("restart failed"));
    mockEmit.mockRejectedValueOnce(new Error("emit also failed"));

    renderHook(() => useUpdateChecker());

    const handler = listenHandlers.get("app:restart-for-update");

    await act(async () => {
      handler!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should not throw even if emit fails in the catch block
    expect(mockRestartWithHotExit).toHaveBeenCalled();
  });

  it("does not show toast when status changes to ready but updateInfo is null", async () => {
    const { toast } = await import("sonner");

    renderHook(() => useUpdateChecker());

    // Transition to checking first, then to ready without updateInfo
    await act(async () => {
      useUpdateStore.getState().setStatus("checking");
    });

    // Set status to ready but ensure updateInfo is null (default state)
    await act(async () => {
      useUpdateStore.getState().setStatus("ready");
    });

    // toast.success should NOT be called because updateInfo is null
    expect(toast.success).not.toHaveBeenCalledWith(
      expect.stringContaining("ready to install"),
      expect.any(Object)
    );
  });

  it("auto-dismisses when available version matches skipVersion (dismiss called)", async () => {
    // Ensure update info is set before skipVersion check triggers
    useSettingsStore.getState().updateUpdateSetting("skipVersion", "3.0.0");

    renderHook(() => useUpdateChecker());

    await act(async () => {
      useUpdateStore.getState().setUpdateInfo({
        version: "3.0.0",
        notes: "test",
        pubDate: "2025-01-01",
        currentVersion: "1.0.0",
      });
      useUpdateStore.getState().setStatus("available");
    });

    expect(useUpdateStore.getState().dismissed).toBe(true);
    expect(mockClearPendingUpdate).toHaveBeenCalled();
  });
});
