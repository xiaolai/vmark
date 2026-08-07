// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const listen = vi.fn(async () => () => {});
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => listen(...a) }));

import { _resetWorkspaceEventSources, subscribeWorkspaceEvents } from "@/services/workspaceEvents/subscribeWorkspaceEvents";

afterEach(() => {
  _resetWorkspaceEventSources();
  listen.mockClear();
});

describe("workspace event source registry", () => {
  it("attaches exactly one fs listener per window, regardless of subscriber count", async () => {
    const off1 = subscribeWorkspaceEvents("main", () => {});
    const off2 = subscribeWorkspaceEvents("main", () => {});
    await Promise.resolve();
    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith("fs:changed", expect.any(Function));
    off1();
    off2();
  });

  it("returns a working unsubscribe", () => {
    const off = subscribeWorkspaceEvents("main", () => {});
    expect(typeof off).toBe("function");
    expect(() => off()).not.toThrow();
  });

  it("creates an independent source per window", async () => {
    subscribeWorkspaceEvents("main", () => {});
    subscribeWorkspaceEvents("second", () => {});
    await Promise.resolve();
    expect(listen).toHaveBeenCalledTimes(2);
  });

  it("re-attaches after the source is reset", async () => {
    subscribeWorkspaceEvents("main", () => {});
    await Promise.resolve();
    _resetWorkspaceEventSources();
    subscribeWorkspaceEvents("main", () => {});
    await Promise.resolve();
    expect(listen).toHaveBeenCalledTimes(2);
  });
});
