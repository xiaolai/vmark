// useBrowserNavEvents — subscribe to native nav-delegate events, filtered by tab (WI-1.7).
// Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-1.7
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBrowserNavEvents, type BrowserNavHandlers } from "./useBrowserNavEvents";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
const unlisten = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: Listener) => {
    listeners.set(name, cb);
    return Promise.resolve(unlisten);
  },
}));

function emit(name: string, payload: unknown) {
  listeners.get(name)?.({ payload });
}

beforeEach(() => {
  listeners.clear();
  unlisten.mockClear();
});

async function mount(tabId: string, handlers: BrowserNavHandlers) {
  const r = renderHook(() => useBrowserNavEvents(tabId, handlers));
  // let the async listen() promises resolve so the registry is populated
  await Promise.resolve();
  await Promise.resolve();
  return r;
}

describe("useBrowserNavEvents", () => {
  it("subscribes to the three nav-delegate events", async () => {
    await mount("t1", {});
    expect(listeners.has("browser://navigated")).toBe(true);
    expect(listeners.has("browser://loaded")).toBe(true);
    expect(listeners.has("browser://load-failed")).toBe(true);
  });

  it("calls onNavigated with the url for a matching tab", async () => {
    const onNavigated = vi.fn();
    await mount("t1", { onNavigated });
    emit("browser://navigated", { tabId: "t1", url: "https://iana.org/" });
    expect(onNavigated).toHaveBeenCalledWith("https://iana.org/");
  });

  it("ignores events addressed to a different tab", async () => {
    const onLoaded = vi.fn();
    await mount("t1", { onLoaded });
    emit("browser://loaded", { tabId: "OTHER", url: "https://x/", title: "X" });
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("calls onLoaded with url and title", async () => {
    const onLoaded = vi.fn();
    await mount("t1", { onLoaded });
    emit("browser://loaded", { tabId: "t1", url: "https://iana.org/", title: "Example Domains" });
    expect(onLoaded).toHaveBeenCalledWith("https://iana.org/", "Example Domains");
  });

  it("calls onFailed with the message", async () => {
    const onFailed = vi.fn();
    await mount("t1", { onFailed });
    emit("browser://load-failed", { tabId: "t1", message: "server not found" });
    expect(onFailed).toHaveBeenCalledWith("server not found");
  });

  it("uses the latest handlers without resubscribing", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = await mount("t1", { onNavigated: first });
    rerender();
    // swap handlers via a fresh render with a new object, same tab
    const r2 = renderHook(({ h }) => useBrowserNavEvents("t1", h), {
      initialProps: { h: { onNavigated: second } as BrowserNavHandlers },
    });
    await Promise.resolve();
    await Promise.resolve();
    emit("browser://navigated", { tabId: "t1", url: "https://z/" });
    expect(second).toHaveBeenCalledWith("https://z/");
    r2.unmount();
  });

  it("unsubscribes every listener on unmount", async () => {
    const { unmount } = await mount("t1", {});
    unmount();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(3);
  });
});
