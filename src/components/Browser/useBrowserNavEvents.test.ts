// useBrowserNavEvents — subscribe to native nav-delegate events, filtered by tab (WI-1.7).
// Plan: dev-docs/plans/20260712-0610-embedded-browser-sites-workflows.md WI-1.7
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { browserWarn } from "@/utils/debug";
import { useBrowserNavEvents, type BrowserNavHandlers } from "./useBrowserNavEvents";

vi.mock("@/utils/debug", () => ({ browserWarn: vi.fn() }));

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
const unlisten = vi.fn();
/** How many times `listen()` was invoked — lets a test detect a resubscription. */
let listenCalls = 0;

/** Swappable so a test can make one registration fail. */
const defaultListen = (name: string, cb: Listener) => {
  listenCalls += 1;
  listeners.set(name, cb);
  return Promise.resolve(unlisten);
};
let listenImpl: (name: string, cb: Listener) => Promise<() => void> = defaultListen;

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: Listener) => listenImpl(name, cb),
}));

function emit(name: string, payload: unknown) {
  listeners.get(name)?.({ payload });
}

beforeEach(() => {
  listeners.clear();
  unlisten.mockClear();
  vi.mocked(browserWarn).mockClear();
  listenImpl = defaultListen;
  listenCalls = 0;
});

async function mount(tabId: string, handlers: BrowserNavHandlers) {
  const r = renderHook(() => useBrowserNavEvents(tabId, handlers));
  // let the async listen() promises resolve so the registry is populated
  await Promise.resolve();
  await Promise.resolve();
  return r;
}

describe("useBrowserNavEvents", () => {
  it("subscribes to the five nav-delegate events", async () => {
    await mount("t1", {});
    expect(listeners.has("browser://navigated")).toBe(true);
    expect(listeners.has("browser://loaded")).toBe(true);
    expect(listeners.has("browser://load-failed")).toBe(true);
    expect(listeners.has("browser://crashed")).toBe(true);
    expect(listeners.has("browser://dialog")).toBe(true);
  });

  it("routes a confirm dialog with its id", async () => {
    const onDialog = vi.fn();
    await mount("t1", { onDialog });
    emit("browser://dialog", { tabId: "t1", kind: "confirm", message: "Sure?", id: 7 });
    expect(onDialog).toHaveBeenCalledWith({ kind: "confirm", message: "Sure?", id: 7 });
  });

  it("calls onCrashed with the recovery action for a matching tab", async () => {
    const onCrashed = vi.fn();
    await mount("t1", { onCrashed });
    emit("browser://crashed", { tabId: "t1", action: "manual" });
    expect(onCrashed).toHaveBeenCalledWith("manual");
  });

  it("ignores a crash addressed to a different tab", async () => {
    const onCrashed = vi.fn();
    await mount("t1", { onCrashed });
    emit("browser://crashed", { tabId: "OTHER", action: "auto-reload" });
    expect(onCrashed).not.toHaveBeenCalled();
  });

  it("calls onNavigated with the url and navigation generation for a matching tab", async () => {
    const onNavigated = vi.fn();
    await mount("t1", { onNavigated });
    // The generation stamps driver operations (WI-2.1) — it must reach the handler
    // so an operation authorized against this page is rejected once it navigates.
    emit("browser://navigated", { tabId: "t1", url: "https://iana.org/", generation: 4 });
    expect(onNavigated).toHaveBeenCalledWith("https://iana.org/", 4);
  });

  // WI-S1.6 (Codex re-review D3#5): the omnibox's back/forward disabled state comes
  // from the webview's own back/forward list, which can change on EITHER event.
  it("reports history state from a committed navigation", async () => {
    const onHistoryChanged = vi.fn();
    await mount("t1", { onHistoryChanged });
    emit("browser://navigated", {
      tabId: "t1",
      url: "https://a.com/",
      generation: 1,
      canGoBack: true,
      canGoForward: false,
    });
    expect(onHistoryChanged).toHaveBeenCalledWith(true, false);
  });

  it("reports history state from a finished load", async () => {
    const onHistoryChanged = vi.fn();
    await mount("t1", { onHistoryChanged });
    emit("browser://loaded", {
      tabId: "t1",
      url: "https://a.com/",
      title: "A",
      canGoBack: false,
      canGoForward: true,
    });
    expect(onHistoryChanged).toHaveBeenCalledWith(false, true);
  });

  it("coerces missing history flags to false rather than passing undefined", async () => {
    const onHistoryChanged = vi.fn();
    await mount("t1", { onHistoryChanged });
    emit("browser://loaded", { tabId: "t1", url: "https://a.com/", title: "A" });
    expect(onHistoryChanged).toHaveBeenCalledWith(false, false);
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
    // Rerender the SAME hook instance with fresh handler closures (same tab), the
    // real scenario: a parent re-render passing new handler objects.
    const { rerender } = renderHook(
      ({ h }: { h: BrowserNavHandlers }) => useBrowserNavEvents("t1", h),
      { initialProps: { h: { onNavigated: first } as BrowserNavHandlers } },
    );
    await Promise.resolve();
    await Promise.resolve();
    const callsAfterMount = listenCalls;
    expect(callsAfterMount).toBe(5); // five events, subscribed once

    rerender({ h: { onNavigated: second } });
    await Promise.resolve();

    // No new subscription happened for the swap — the effect keys on tabId only.
    expect(listenCalls).toBe(callsAfterMount);

    emit("browser://navigated", { tabId: "t1", url: "https://z/", generation: 1 });
    // The event routes to the LATEST handler (ref-fresh), not the one captured at
    // mount — and the stale handler is never called.
    expect(second).toHaveBeenCalledWith("https://z/", 1);
    expect(first).not.toHaveBeenCalled();
  });

  it("unsubscribes every listener on unmount", async () => {
    const { unmount } = await mount("t1", {});
    unmount();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(5);
  });
});

describe("hostile payloads are narrowed at the boundary", () => {
  it("narrows an unknown crash action to 'manual' (never claim a reload that is not happening)", async () => {
    const onCrashed = vi.fn();
    await mount("t1", { onCrashed });
    emit("browser://crashed", { tabId: "t1", action: "who-knows" });
    // "auto-reload" would tell the user to wait for a recovery nobody scheduled.
    expect(onCrashed).toHaveBeenCalledWith("manual");
  });

  it("routes a confirm WITHOUT an id as an alert (an unanswerable confirm is not a confirm)", async () => {
    const onDialog = vi.fn();
    await mount("t1", { onDialog });
    emit("browser://dialog", { tabId: "t1", kind: "confirm", message: "Sure?" });
    // Without the id there is no way to answer the page — never offer Cancel/OK
    // as if the answer would reach it.
    expect(onDialog).toHaveBeenCalledWith({ kind: "alert", message: "Sure?" });
  });

  it("narrows an unknown dialog kind to an alert", async () => {
    const onDialog = vi.fn();
    await mount("t1", { onDialog });
    emit("browser://dialog", { tabId: "t1", kind: "prompt", message: "Name?" });
    expect(onDialog).toHaveBeenCalledWith({ kind: "alert", message: "Name?" });
  });
});

describe("subscription failures", () => {
  it("reports a failed registration instead of dropping it as an unhandled rejection", async () => {
    listenImpl = (name, cb) => {
      if (name === "browser://crashed") return Promise.reject(new Error("listen failed"));
      listeners.set(name, cb);
      return Promise.resolve(unlisten);
    };

    const onLoaded = vi.fn();
    const { unmount } = await mount("t1", { onLoaded });

    // A silently dead crash listener means the surface never shows the crash
    // overlay — the failure has to surface.
    expect(browserWarn).toHaveBeenCalledWith(
      expect.stringContaining("browser://crashed"),
      expect.any(Error),
    );

    // The other four still work — one failed registration is not a dead surface.
    emit("browser://loaded", { tabId: "t1", url: "https://x/", title: "X" });
    expect(onLoaded).toHaveBeenCalledWith("https://x/", "X");

    unmount();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(4); // only the ones that registered
  });
});
