// WI-1.12 — watcher wiring: fs:changed events trigger one debounced
// kernel scan (bursts collapse), no scan without a workspace, failures
// stay silent, and the disposer cancels cleanly.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { startCoherenceScanOnChange } from "./scanOnChange";
import { useWorkspaceStore } from "@/stores/workspaceStore";

type Handler = (event: unknown) => void;

function makeDeps() {
  let handler: Handler | null = null;
  const unlisten = vi.fn();
  const invoke = vi.fn().mockResolvedValue({});
  const listen = vi.fn(async (_event: string, h: Handler) => {
    handler = h;
    return unlisten;
  });
  return {
    deps: { listen, invoke } as never,
    fire: () => handler?.({ payload: {} }),
    invoke,
    listen,
    unlisten,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useWorkspaceStore.setState({ rootPath: "/ws/story" });
});

describe("startCoherenceScanOnChange", () => {
  it("debounces a burst of events into one scan", async () => {
    const { deps, fire, invoke } = makeDeps();
    startCoherenceScanOnChange(deps);
    await vi.advanceTimersByTimeAsync(0); // listener registration
    fire();
    fire();
    fire();
    await vi.advanceTimersByTimeAsync(3100);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("coherence_scan", { workspaceRoot: "/ws/story" });
  });

  it("does nothing without an open workspace", async () => {
    useWorkspaceStore.setState({ rootPath: null });
    const { deps, fire, invoke } = makeDeps();
    startCoherenceScanOnChange(deps);
    await vi.advanceTimersByTimeAsync(0);
    fire();
    await vi.advanceTimersByTimeAsync(3100);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("scan failures are swallowed and later events scan again", async () => {
    const { deps, fire, invoke } = makeDeps();
    invoke.mockRejectedValueOnce(new Error("kernel down"));
    startCoherenceScanOnChange(deps);
    await vi.advanceTimersByTimeAsync(0);
    fire();
    await vi.advanceTimersByTimeAsync(3100);
    fire();
    await vi.advanceTimersByTimeAsync(3100);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("disposer cancels pending timer and unlistens", async () => {
    const { deps, fire, invoke, unlisten } = makeDeps();
    const stop = startCoherenceScanOnChange(deps);
    await vi.advanceTimersByTimeAsync(0);
    fire();
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(invoke).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalled();
  });
});
