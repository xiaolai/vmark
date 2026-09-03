// @vitest-environment node
// Audit 2026-09-03 (round 2, #78) — concurrent destroys of one tab share a single
// native teardown: the second call joins the first instead of clearing the
// in-flight marker under it, and a later destroy runs again once it has settled.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: [string, Record<string, unknown>?]) => invoke(...a) }));
vi.mock("@/utils/debug", () => ({ browserWarn: vi.fn() }));
vi.mock("./browserOcclusion", () => ({ browserOcclusion: { removeTab: vi.fn(), register: vi.fn() }, OCCLUDER: {} }));
vi.mock("./browserEventBroker", () => ({ browserEventBroker: { cancelTab: vi.fn() } }));
vi.mock("./navIntent", () => ({ clearNavIntent: vi.fn() }));

import { destroyBrowserNativeView } from "./browserNativeViews";
import { browserWarn } from "@/utils/debug";

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(browserWarn).mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("destroyBrowserNativeView", () => {
  it("two concurrent destroys issue ONE browser_destroy and both settle together", async () => {
    let release: () => void = () => {};
    invoke.mockImplementation(() => new Promise<void>((r) => (release = r)));
    const first = destroyBrowserNativeView("t1");
    const second = destroyBrowserNativeView("t1");
    await Promise.resolve();
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "browser_destroy")).toHaveLength(1);
    release();
    await Promise.all([first, second]);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "browser_destroy")).toHaveLength(1);
  });

  it("a destroy after the first has settled runs its own teardown", async () => {
    invoke.mockResolvedValue(undefined);
    await destroyBrowserNativeView("t2");
    await destroyBrowserNativeView("t2");
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "browser_destroy")).toHaveLength(2);
  });

  it("a transient browser_destroy failure is retried and then succeeds without a warning (#79)", async () => {
    invoke.mockRejectedValueOnce(new Error("busy")).mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
    const done = destroyBrowserNativeView("t3");
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "browser_destroy")).toHaveLength(3);
    expect(browserWarn).not.toHaveBeenCalled();
  });

  it("a teardown that fails every attempt is reported once and still releases the marker", async () => {
    invoke.mockRejectedValue(new Error("gone"));
    const done = destroyBrowserNativeView("t4");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(done).resolves.toBeUndefined();
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "browser_destroy")).toHaveLength(3);
    expect(browserWarn).toHaveBeenCalledTimes(1);
    invoke.mockResolvedValue(undefined);
    await destroyBrowserNativeView("t4");
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "browser_destroy")).toHaveLength(4);
  });
});
