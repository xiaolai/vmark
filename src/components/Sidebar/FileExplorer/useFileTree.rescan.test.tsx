/**
 * useFileTree — #1357: fs events must never turn the tree scan into a loop.
 *
 * The reporter's log: 19–23 full rescans a minute for 36 minutes, one core pinned,
 * because every event batch rescanned and a batch that landed during a scan
 * restarted it at once. These pin the hook's use of the scheduler: one listing per
 * burst, back-off under continuous churn, and one IPC call per listing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

let wsEventCallback: ((events: unknown[]) => void) | null = null;
vi.mock("@/services/workspaceEvents/subscribeWorkspaceEvents", () => ({
  subscribeWorkspaceEvents: (_label: string, cb: (events: unknown[]) => void) => {
    wsEventCallback = cb;
    return () => {
      wsEventCallback = null;
    };
  },
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ onFocusChanged: async () => () => {} }),
}));

import { useFileTree } from "./useFileTree";
import { DEFAULT_RESCAN_TIMING } from "./rescanScheduler";

const listings = () => invokeMock.mock.calls.filter(([cmd]) => cmd === "list_directory_tree");

beforeEach(() => {
  vi.useFakeTimers();
  invokeMock.mockReset();
  wsEventCallback = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useFileTree — rescans are paced (#1357)", () => {
  it("lists the tree in ONE IPC call, with the exclusions and hidden flag passed to the walker", async () => {
    invokeMock.mockResolvedValue({
      entries: [
        { name: "docs", path: "/root/docs", isDirectory: true, isHidden: false, children: [
          { name: "a.md", path: "/root/docs/a.md", isDirectory: false, isHidden: false },
        ] },
        { name: "readme.md", path: "/root/readme.md", isDirectory: false, isHidden: false },
      ],
      truncated: false,
    });
    const { result } = renderHook(() => useFileTree("/root", { excludeFolders: ["vendor"], showHidden: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(listings()).toHaveLength(1);
    expect(listings()[0][1]).toEqual({ path: "/root", options: { excludeFolders: ["vendor"], showHidden: true } });
    expect(result.current.tree.map((n) => n.name)).toEqual(["docs", "readme.md"]);
    expect(result.current.tree[0].children?.map((n) => n.name)).toEqual(["a.md"]);
    expect(result.current.truncated).toBe(false);
  });

  it("a burst of event batches is ONE re-listing, after the burst goes quiet", async () => {
    invokeMock.mockResolvedValue({ entries: [], truncated: false });
    renderHook(() => useFileTree("/root"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(listings()).toHaveLength(1);
    for (let i = 0; i < 20; i++) {
      wsEventCallback!([{ kind: "create" }]);
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    }
    expect(listings()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(DEFAULT_RESCAN_TIMING.quietMs); });
    expect(listings()).toHaveLength(2);
  });

  it("events landing during every scan do NOT restart it back to back — the interval widens", async () => {
    // A 3 s scan and an event every 500 ms, the reporter's shape, for five minutes.
    invokeMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ entries: [], truncated: false }), 3_000)),
    );
    renderHook(() => useFileTree("/root"));
    for (let t = 0; t < 5 * 60_000; t += 500) {
      wsEventCallback?.([{ kind: "modify" }]);
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    }
    const backToBack = (5 * 60_000) / 3_000;
    expect(listings().length).toBeLessThan(backToBack / 4);
  });

  it("reports a truncated listing and still shows what was listed", async () => {
    invokeMock.mockResolvedValue({
      entries: [{ name: "a.md", path: "/root/a.md", isDirectory: false, isHidden: false }],
      truncated: true,
    });
    const { result } = renderHook(() => useFileTree("/root"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.truncated).toBe(true);
    expect(result.current.tree.map((n) => n.name)).toEqual(["a.md"]);
  });

  it("refresh() resolves after its listing has run, so a create flow can rename the new node", async () => {
    invokeMock.mockResolvedValue({ entries: [], truncated: false });
    const { result } = renderHook(() => useFileTree("/root"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const before = listings().length;
    let resolved = false;
    void result.current.refresh().then(() => { resolved = true; });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(listings().length).toBe(before + 1);
    expect(resolved).toBe(true);
  });
});
