// @vitest-environment node
// Audit 2026-09-03 (round 1) — the window-level native-event decoder: validates what
// it forwards, carries the generation into history updates, and retries a failed
// listener registration loudly instead of dying quietly.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserWarn } from "@/utils/debug";
import { subscribeBrowserNavEvents, type TabNavHandlers } from "./browserNavEvents";

vi.mock("@/utils/debug", () => ({ browserWarn: vi.fn() }));

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
const unlisten = vi.fn();
let listenCalls = 0;
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

async function subscribe(handlers: TabNavHandlers) {
  const stop = subscribeBrowserNavEvents(() => handlers);
  await Promise.resolve();
  await Promise.resolve();
  return stop;
}

beforeEach(() => {
  listeners.clear();
  unlisten.mockClear();
  vi.mocked(browserWarn).mockClear();
  listenImpl = defaultListen;
  listenCalls = 0;
});

describe("subscribeBrowserNavEvents", () => {
  it("forwards a well-formed commit with its tab, generation and history state", async () => {
    const onNavigated = vi.fn();
    const onHistoryChanged = vi.fn();
    await subscribe({ onNavigated, onHistoryChanged });
    emit("browser://navigated", {
      tabId: "t1",
      url: "https://a.example/",
      generation: 4,
      redirected: true,
      navigationId: "nav-9",
      canGoBack: true,
    });
    expect(onNavigated).toHaveBeenCalledWith("t1", "https://a.example/", 4, true, "nav-9");
    // The generation rides along so a stale history event can be ignored downstream.
    expect(onHistoryChanged).toHaveBeenCalledWith("t1", true, false, 4);
  });

  it("drops a malformed navigation payload with a warning instead of forwarding undefined", async () => {
    const onNavigated = vi.fn();
    const onLoaded = vi.fn();
    await subscribe({ onNavigated, onLoaded });
    emit("browser://navigated", { tabId: "t1", url: "https://a.example/" }); // no generation
    emit("browser://loaded", { tabId: "t1", generation: 2, title: "x" }); // no url
    expect(onNavigated).not.toHaveBeenCalled();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(browserWarn).toHaveBeenCalledTimes(2);
  });

  it("forwards a finished load, defaulting a missing title to the empty string", async () => {
    const onLoaded = vi.fn();
    await subscribe({ onLoaded });
    emit("browser://loaded", { tabId: "t1", url: "https://a.example/", generation: 2 });
    expect(onLoaded).toHaveBeenCalledWith("t1", "https://a.example/", "", 2);
  });

  it("retries a failed registration, warning on every attempt, and gives up after the budget", async () => {
    vi.useFakeTimers();
    try {
      listenImpl = (name, cb) =>
        name === "browser://dialog" ? Promise.reject(new Error("ipc not ready")) : defaultListen(name, cb);
      const onDialog = vi.fn();
      const stop = subscribeBrowserNavEvents(() => ({ onDialog }));
      await vi.advanceTimersByTimeAsync(0);
      expect(browserWarn).toHaveBeenCalledTimes(1);
      expect(vi.mocked(browserWarn).mock.calls[0]?.[0]).toMatch(/attempt 1\/3.*retrying/);
      await vi.advanceTimersByTimeAsync(250);
      expect(browserWarn).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(500);
      expect(browserWarn).toHaveBeenCalledTimes(3);
      expect(vi.mocked(browserWarn).mock.calls[2]?.[0]).toMatch(/attempt 3\/3.*giving up/);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(browserWarn).toHaveBeenCalledTimes(3);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a registration that succeeds on retry is live, and unsubscribing undoes it", async () => {
    vi.useFakeTimers();
    try {
      let failures = 1;
      listenImpl = (name, cb) => {
        if (name === "browser://crashed" && failures-- > 0) return Promise.reject(new Error("not yet"));
        return defaultListen(name, cb);
      };
      const onCrashed = vi.fn();
      const stop = subscribeBrowserNavEvents(() => ({ onCrashed }));
      await vi.advanceTimersByTimeAsync(300);
      emit("browser://crashed", { tabId: "t1", action: "manual" });
      expect(onCrashed).toHaveBeenCalledWith("t1", "manual");
      const registered = listenCalls;
      stop();
      expect(unlisten).toHaveBeenCalledTimes(registered);
    } finally {
      vi.useRealTimers();
    }
  });
});
