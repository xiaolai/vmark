// @vitest-environment node
// A history backend that never answers cannot hold a save open: the snapshot
// is given up after SNAPSHOT_TIMEOUT_MS like any failed snapshot — logged,
// warned once per session — and the save it belongs to resolves.
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

const createSnapshot = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>());
const warning = vi.hoisted(() => vi.fn());
vi.mock("@/services/history/historyOperations", () => ({ createSnapshot }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { warning } }));

import { useSettingsStore } from "@/stores/settingsStore";
import { SNAPSHOT_TIMEOUT_MS, __resetSnapshotFlags, recordHistorySnapshot } from "./saveHistorySnapshot";

beforeEach(() => {
  vi.useFakeTimers();
  createSnapshot.mockReset();
  warning.mockClear();
  __resetSnapshotFlags();
  useSettingsStore.setState((state) => ({ general: { ...state.general, historyEnabled: true } }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordHistorySnapshot with a hung backend", () => {
  it("resolves at the deadline, not before, and warns once per session", async () => {
    createSnapshot.mockImplementation(() => new Promise<void>(() => {}));
    let settled = false;
    const first = recordHistorySnapshot("/w/a.md", "one", "manual").then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(SNAPSHOT_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(settled).toBe(true);

    const second = recordHistorySnapshot("/w/a.md", "two", "auto");
    await vi.advanceTimersByTimeAsync(SNAPSHOT_TIMEOUT_MS);
    await second;
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it("a snapshot that answers in time is not warned about, and leaves no timer behind", async () => {
    createSnapshot.mockResolvedValue(undefined);
    await recordHistorySnapshot("/w/a.md", "one", "mcp");
    expect(vi.getTimerCount()).toBe(0);
    expect(warning).not.toHaveBeenCalled();
  });

  it("a snapshot that lands past the deadline by the monotonic clock, before the timer fires, is given up", async () => {
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      // The work stalls the event loop past the deadline, so its answer is
      // queued ahead of the timer.
      createSnapshot.mockImplementation(async () => {
        clock += SNAPSHOT_TIMEOUT_MS + 1;
      });
      await recordHistorySnapshot("/w/a.md", "one", "manual");
      expect(warning).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      now.mockRestore();
    }
  });

  it("a snapshot that rejects after the deadline raises nothing further", async () => {
    let reject: (e: Error) => void = () => {};
    createSnapshot.mockImplementation(() => new Promise<void>((_, r) => (reject = r)));
    const recording = recordHistorySnapshot("/w/a.md", "one", "manual");
    await vi.advanceTimersByTimeAsync(SNAPSHOT_TIMEOUT_MS);
    await recording;
    reject(new Error("late"));
    await vi.advanceTimersByTimeAsync(0);
    expect(warning).toHaveBeenCalledTimes(1);
  });
});
