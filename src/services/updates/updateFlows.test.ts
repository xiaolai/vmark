// @vitest-environment jsdom
/**
 * The update check and download flows, driven directly against a fake updater
 * plugin: one plugin call per window however many callers pile on, the store
 * states each outcome leaves behind, and a guard that is always released once
 * the call settles — so a later attempt reaches the plugin again.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

const mockCheck = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => mockCheck(...args),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("1.0.0"),
}));

import { useMcpStore } from "@/stores/mcpStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { runUpdateCheck, runUpdateDownload } from "./updateFlows";
import { clearInFlight, inFlight } from "./updateSingleFlight";

type Download = (onEvent: (event: DownloadEvent) => void) => Promise<void>;

function fakeUpdate(download: Download): Update {
  const fake = { version: "2.0.0", body: "notes", date: "2026-01-01", downloadAndInstall: download };
  return fake as unknown as Update;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const update = () => useMcpStore.getState().update;
const lastCheck = () => useSettingsStore.getState().update.lastCheckTimestamp;

beforeEach(() => {
  clearInFlight();
  mockCheck.mockReset();
  useMcpStore.getState().resetUpdate();
  useSettingsStore.getState().updateUpdateSetting("lastCheckTimestamp", null);
});

describe("runUpdateCheck", () => {
  it("bounds the plugin call with a timeout", async () => {
    mockCheck.mockResolvedValue(null);
    await runUpdateCheck();
    expect(mockCheck).toHaveBeenCalledWith({ timeout: 30_000 });
  });

  it("shares one plugin call between overlapping callers, then releases the guard", async () => {
    const reply = deferred<Update | null>();
    mockCheck.mockReturnValue(reply.promise);

    const first = runUpdateCheck();
    const second = runUpdateCheck();
    expect(update().status).toBe("checking");
    reply.resolve(null);

    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(inFlight.check).toBeNull();

    mockCheck.mockResolvedValue(null);
    await runUpdateCheck();
    expect(mockCheck).toHaveBeenCalledTimes(2);
  });

  it("records a found update, re-shows a dismissed banner and stamps the check", async () => {
    useMcpStore.getState().dismissUpdate();
    const found = fakeUpdate(() => Promise.resolve());
    mockCheck.mockResolvedValue(found);

    await expect(runUpdateCheck()).resolves.toBe(true);

    expect(update().status).toBe("available");
    expect(update().pendingUpdate).toBe(found);
    expect(update().updateInfo).toEqual({
      version: "2.0.0",
      notes: "notes",
      pubDate: "2026-01-01",
      currentVersion: "1.0.0",
    });
    expect(update().dismissed).toBe(false);
    expect(lastCheck()).toEqual(expect.any(Number));
  });

  it("reports up to date, drops a stale pending update and stamps the check", async () => {
    useMcpStore.getState().setPendingUpdate(fakeUpdate(() => Promise.resolve()));
    mockCheck.mockResolvedValue(null);

    await expect(runUpdateCheck()).resolves.toBe(false);

    expect(update().status).toBe("up-to-date");
    expect(update().pendingUpdate).toBeNull();
    expect(lastCheck()).toEqual(expect.any(Number));
  });

  it("surfaces a failure without stamping the check, and releases the guard", async () => {
    mockCheck.mockRejectedValue(new Error("offline"));

    await expect(runUpdateCheck()).resolves.toBe(false);

    expect(update().status).toBe("error");
    expect(update().error).toBe("offline");
    expect(lastCheck()).toBeNull();
    expect(inFlight.check).toBeNull();
  });

  it("falls back to a translated message when the plugin rejects with a non-Error", async () => {
    mockCheck.mockRejectedValue("boom");
    await runUpdateCheck();
    expect(update().error).toBeTruthy();
    expect(update().error).not.toBe("boom");
  });
});

describe("runUpdateDownload", () => {
  it("refuses without a pending update and never sets the guard", async () => {
    await expect(runUpdateDownload()).resolves.toBe(false);
    expect(inFlight.download).toBeNull();
    expect(update().status).toBe("idle");
  });

  it("walks downloading → installing → ready, snapping progress to the total", async () => {
    const statuses: string[] = [];
    const unsubscribe = useMcpStore.subscribe((s, prev) => {
      if (s.update.status !== prev.update.status) statuses.push(s.update.status);
    });
    const seen: Array<{ downloaded: number; total: number | null } | null> = [];
    const download: Download = async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 1000 } });
      onEvent({ event: "Progress", data: { chunkLength: 400 } });
      seen.push(update().downloadProgress);
      onEvent({ event: "Progress", data: { chunkLength: 600 } });
      onEvent({ event: "Finished" });
      seen.push(update().downloadProgress);
    };
    useMcpStore.getState().setPendingUpdate(fakeUpdate(download));

    await expect(runUpdateDownload()).resolves.toBe(true);
    unsubscribe();

    expect(seen).toEqual([
      { downloaded: 400, total: 1000 },
      { downloaded: 1000, total: 1000 },
    ]);
    expect(statuses).toEqual(["downloading", "installing", "ready"]);
    expect(update().downloadProgress).toBeNull();
    expect(inFlight.download).toBeNull();
  });

  it("does not write progress for a chunk that moves no whole percent", async () => {
    const writes: Array<number | undefined> = [];
    const download: Download = async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 100_000 } });
      const unsubscribe = useMcpStore.subscribe((s, prev) => {
        if (s.update.downloadProgress !== prev.update.downloadProgress) {
          writes.push(s.update.downloadProgress?.downloaded);
        }
      });
      onEvent({ event: "Progress", data: { chunkLength: 10 } });
      onEvent({ event: "Progress", data: { chunkLength: 2_000 } });
      unsubscribe();
    };
    useMcpStore.getState().setPendingUpdate(fakeUpdate(download));

    await runUpdateDownload();

    expect(writes).toEqual([2_010]);
  });

  it("shares one download between overlapping callers", async () => {
    const finish = deferred<void>();
    const download = vi.fn<Download>(() => finish.promise);
    useMcpStore.getState().setPendingUpdate(fakeUpdate(download));

    const first = runUpdateDownload();
    const second = runUpdateDownload();
    finish.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed download, clears progress and releases the guard", async () => {
    useMcpStore
      .getState()
      .setPendingUpdate(fakeUpdate(() => Promise.reject(new Error("disk full"))));

    await expect(runUpdateDownload()).resolves.toBe(false);

    expect(update().status).toBe("error");
    expect(update().error).toBe("disk full");
    expect(update().downloadProgress).toBeNull();
    expect(inFlight.download).toBeNull();
  });
});

describe("clearInFlight", () => {
  it("lets the next check reach the plugin past a call that never settles", async () => {
    mockCheck.mockReturnValue(new Promise(() => {}));
    void runUpdateCheck();
    void runUpdateCheck();
    expect(mockCheck).toHaveBeenCalledTimes(1);

    clearInFlight();
    expect(inFlight).toEqual({ check: null, download: null });

    mockCheck.mockResolvedValue(null);
    await expect(runUpdateCheck()).resolves.toBe(false);
    expect(mockCheck).toHaveBeenCalledTimes(2);
  });
});
