// @vitest-environment node
// Audit 2026-09-03 round 3, #167 — one tab's `browser_set_bounds` reports go through a
// serialized, latest-wins channel that waits for the native view to exist and retries
// a refusal with backoff until the surface unmounts. Before: every rect was its own
// fire-and-forget invoke, retried three times on a fixed timer, so two rapid reports
// could land out of order and a create slower than ~900 ms exhausted the budget before
// there was a view to align.
import { describe, it, expect, vi } from "vitest";

const invoke = vi.fn<(cmd: string, args: unknown) => Promise<void>>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...(a as [string, unknown])) }));
const warn = vi.fn();
vi.mock("@/utils/debug", () => ({ browserWarn: (...a: unknown[]) => warn(...a) }));

import { makeBoundsPusher } from "./browserBounds";

const flush = () => new Promise((r) => setTimeout(r, 0));
const rect = (width: number) => ({ x: 1, y: 2, width, height: 4 });
const noSleep = async () => {};
/** A backoff that yields to the macrotask queue. A driver that refuses FOREVER plus a
 *  sleep that resolves immediately is an unbroken microtask chain — `flush()` never
 *  runs, and the loop spins until the worker is out of memory. */
const yieldSleep = () => new Promise<void>((r) => setTimeout(r, 0));

describe("makeBoundsPusher", () => {
  it("sends the rect as browser_set_bounds for the tab once creation has settled", async () => {
    invoke.mockReset().mockResolvedValue(undefined);
    const pusher = makeBoundsPusher("t1", Promise.resolve(), noSleep);
    pusher.push(rect(100));
    await flush();
    expect(invoke).toHaveBeenCalledWith("browser_set_bounds", { tabId: "t1", x: 1, y: 2, width: 100, height: 4 });
    expect(pusher.isConverged()).toBe(true);
  });

  it("holds the report until creation settles, and then sends only the LATEST rect", async () => {
    invoke.mockReset().mockResolvedValue(undefined);
    let settle!: () => void;
    const created = new Promise<void>((r) => {
      settle = r;
    });
    const pusher = makeBoundsPusher("t1", created, noSleep);
    pusher.push(rect(100));
    pusher.push(rect(200));
    await flush();
    // No view yet — nothing was asked of the driver, so no retry budget was spent either.
    expect(invoke).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    settle();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("browser_set_bounds", expect.objectContaining({ width: 200 }));
  });

  it("a create that FAILED still lets the report go out — the driver's refusal is what gets retried", async () => {
    // The hook's own create can lose to another path (an MCP open after approval
    // creates the same tab's view); waiting on success would hold the rect forever.
    invoke.mockReset().mockRejectedValueOnce(new Error("no view")).mockResolvedValue(undefined);
    warn.mockReset();
    const pusher = makeBoundsPusher("t1", Promise.reject(new Error("create failed")), noSleep);
    pusher.push(rect(100));
    await flush();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(pusher.isConverged()).toBe(true);
  });

  it("retries a refused report with backoff and reports every failure with its attempt number", async () => {
    invoke
      .mockReset()
      .mockRejectedValueOnce(new Error("no view"))
      .mockRejectedValueOnce(new Error("still no view"))
      .mockResolvedValue(undefined);
    warn.mockReset();
    const sleeps: number[] = [];
    const pusher = makeBoundsPusher("t1", Promise.resolve(), async (ms) => {
      sleeps.push(ms);
    });
    pusher.push(rect(100));
    await flush();
    await flush();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(1, expect.stringContaining("browser_set_bounds"), expect.objectContaining({ tabId: "t1", attempt: 1 }));
    expect(warn).toHaveBeenNthCalledWith(2, expect.stringContaining("browser_set_bounds"), expect.objectContaining({ tabId: "t1", attempt: 2 }));
    expect(pusher.isConverged()).toBe(true);
  });

  it("dispose ends the retry loop — an unmounted surface never re-aligns a view", async () => {
    invoke.mockReset().mockRejectedValue(new Error("no view"));
    const pusher = makeBoundsPusher("t1", Promise.resolve(), yieldSleep);
    pusher.push(rect(100));
    await flush();
    pusher.dispose();
    await flush();
    await flush();
    const after = invoke.mock.calls.length;
    pusher.push(rect(200));
    await flush();
    expect(invoke.mock.calls.length).toBe(after);
  });
});
