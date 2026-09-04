// @vitest-environment node
// Audit 2026-09-03 round 3 (#80) — the fan-out hub: ONE native subscription per
// event, decoded once, delivered to every subscriber. Registration is ref-counted
// (first subscriber registers, last unsubscribe unlistens), retried with backoff and
// warned about on every failure, and re-armed when a new subscriber arrives after
// the budget was spent — so the broker's `start()` can still fail loudly and retry
// later while the UI subscriber keeps its warn-and-carry-on posture.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserWarn } from "@/utils/debug";
import { BROWSER_NATIVE_EVENTS } from "./browserNativeEventDecoder";
import { BrowserNativeEventHub, type BrowserNativeEvent } from "./browserNativeEvents";

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

const NAVIGATED = { tabId: "t1", url: "https://a.example/", generation: 1, navigationId: "nav-1" };

beforeEach(() => {
  listeners.clear();
  unlisten.mockClear();
  vi.mocked(browserWarn).mockClear();
  listenImpl = defaultListen;
  listenCalls = 0;
});
afterEach(() => vi.useRealTimers());

describe("BrowserNativeEventHub — one registration, many subscribers", () => {
  it("registers every native event exactly once for the first subscriber, and none for the second", async () => {
    const hub = new BrowserNativeEventHub();
    const first = hub.subscribe(() => {});
    await first.ready;
    expect(listenCalls).toBe(BROWSER_NATIVE_EVENTS.length);
    expect([...listeners.keys()].sort()).toEqual([...BROWSER_NATIVE_EVENTS].sort());

    const second = hub.subscribe(() => {});
    await second.ready;
    expect(listenCalls).toBe(BROWSER_NATIVE_EVENTS.length);
    first.unsubscribe();
    second.unsubscribe();
  });

  it("fans one decoded event out to every subscriber", async () => {
    const hub = new BrowserNativeEventHub();
    const a = vi.fn<(e: BrowserNativeEvent) => void>();
    const b = vi.fn<(e: BrowserNativeEvent) => void>();
    const subA = hub.subscribe(a);
    const subB = hub.subscribe(b);
    await Promise.all([subA.ready, subB.ready]);

    emit("browser://navigated", NAVIGATED);
    const expected = expect.objectContaining({ kind: "navigated", tabId: "t1", navigationId: "nav-1" });
    expect(a).toHaveBeenCalledWith(expected);
    expect(b).toHaveBeenCalledWith(expected);
    // The SAME object: decoded once, not once per subscriber.
    expect(a.mock.calls[0]?.[0]).toBe(b.mock.calls[0]?.[0]);
    subA.unsubscribe();
    subB.unsubscribe();
  });

  it("decodes once: a malformed payload reaches nobody and warns once, however many subscribers", async () => {
    const hub = new BrowserNativeEventHub();
    const a = vi.fn();
    const b = vi.fn();
    const subA = hub.subscribe(a);
    const subB = hub.subscribe(b);
    await Promise.all([subA.ready, subB.ready]);
    emit("browser://loaded", { tabId: "t1", navigationId: "nav-1" }); // no url, no generation
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(browserWarn).toHaveBeenCalledTimes(1);
    subA.unsubscribe();
    subB.unsubscribe();
  });

  it("keeps the registration while any subscriber remains, and unlistens everything at the last unsubscribe", async () => {
    const hub = new BrowserNativeEventHub();
    const a = vi.fn();
    const subA = hub.subscribe(a);
    const subB = hub.subscribe(() => {});
    await Promise.all([subA.ready, subB.ready]);

    subB.unsubscribe();
    expect(unlisten).not.toHaveBeenCalled();
    emit("browser://navigated", NAVIGATED);
    expect(a).toHaveBeenCalledTimes(1);

    subA.unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(BROWSER_NATIVE_EVENTS.length);
    // Unsubscribing twice is a no-op, not a second unlisten.
    subA.unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(BROWSER_NATIVE_EVENTS.length);
  });

  it("re-registers for a subscriber that arrives after the last one left", async () => {
    const hub = new BrowserNativeEventHub();
    const first = hub.subscribe(() => {});
    await first.ready;
    first.unsubscribe();
    listeners.clear();

    const again = vi.fn();
    const second = hub.subscribe(again);
    await second.ready;
    expect(listenCalls).toBe(BROWSER_NATIVE_EVENTS.length * 2);
    emit("browser://navigated", NAVIGATED);
    expect(again).toHaveBeenCalledTimes(1);
    second.unsubscribe();
  });

  it("a subscriber that unsubscribes during dispatch does not starve the others", async () => {
    const hub = new BrowserNativeEventHub();
    const later = vi.fn();
    const sub = hub.subscribe(() => sub.unsubscribe());
    const subLater = hub.subscribe(later);
    await Promise.all([sub.ready, subLater.ready]);
    emit("browser://navigated", NAVIGATED);
    expect(later).toHaveBeenCalledTimes(1);
    subLater.unsubscribe();
  });

  it("an unsubscribe before listen() resolves undoes the registration when it lands", async () => {
    let resolveListen: ((un: () => void) => void) | null = null;
    listenImpl = (name, cb) => {
      if (name !== "browser://popup") return defaultListen(name, cb);
      return new Promise((resolve) => {
        resolveListen = resolve;
      });
    };
    const hub = new BrowserNativeEventHub();
    const sub = hub.subscribe(() => {});
    await Promise.resolve();
    sub.unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(BROWSER_NATIVE_EVENTS.length - 1);
    const lateUnlisten = vi.fn();
    resolveListen!(lateUnlisten);
    await Promise.resolve();
    await Promise.resolve();
    expect(lateUnlisten).toHaveBeenCalledTimes(1);
  });
});

describe("BrowserNativeEventHub — registration failure", () => {
  it("retries with backoff, warning on every attempt, and rejects `ready` once the budget is spent", async () => {
    vi.useFakeTimers();
    listenImpl = (name, cb) =>
      name === "browser://dialog" ? Promise.reject(new Error("ipc not ready")) : defaultListen(name, cb);
    const hub = new BrowserNativeEventHub();
    const sub = hub.subscribe(() => {});
    const outcome = sub.ready.then(
      () => "resolved",
      (error: unknown) => `rejected: ${error instanceof Error ? error.message : String(error)}`,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(browserWarn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(browserWarn).mock.calls[0]?.[0]).toMatch(/attempt 1\/3.*retrying/);
    await vi.advanceTimersByTimeAsync(250);
    expect(browserWarn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(browserWarn).toHaveBeenCalledTimes(3);
    expect(vi.mocked(browserWarn).mock.calls[2]?.[0]).toMatch(/attempt 3\/3.*giving up/);
    await expect(outcome).resolves.toBe("rejected: ipc not ready");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(browserWarn).toHaveBeenCalledTimes(3);
    sub.unsubscribe();
  });

  it("the other events stay live while one registration fails — a UI subscriber keeps receiving them", async () => {
    vi.useFakeTimers();
    listenImpl = (name, cb) =>
      name === "browser://dialog" ? Promise.reject(new Error("ipc not ready")) : defaultListen(name, cb);
    const hub = new BrowserNativeEventHub();
    const seen = vi.fn();
    const sub = hub.subscribe(seen);
    sub.ready.catch(() => {});
    await vi.advanceTimersByTimeAsync(1_000);
    emit("browser://navigated", NAVIGATED);
    expect(seen).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it("a registration that succeeds on retry is live, and the last unsubscribe undoes it", async () => {
    vi.useFakeTimers();
    let failures = 1;
    listenImpl = (name, cb) => {
      if (name === "browser://crashed" && failures-- > 0) return Promise.reject(new Error("not yet"));
      return defaultListen(name, cb);
    };
    const hub = new BrowserNativeEventHub();
    const seen = vi.fn();
    const sub = hub.subscribe(seen);
    await vi.advanceTimersByTimeAsync(300);
    await expect(sub.ready).resolves.toBeUndefined();
    emit("browser://crashed", { tabId: "t1", action: "manual" });
    expect(seen).toHaveBeenCalledWith({ kind: "crashed", tabId: "t1", action: "manual" });
    sub.unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(listenCalls);
  });

  it("re-arms a spent registration for the next subscriber, so a later start() can succeed", async () => {
    vi.useFakeTimers();
    let broken = true;
    listenImpl = (name, cb) =>
      name === "browser://loaded" && broken ? Promise.reject(new Error("ipc down")) : defaultListen(name, cb);
    const hub = new BrowserNativeEventHub();
    const ui = hub.subscribe(() => {}); // stays subscribed, like the window-level UI consumer
    ui.ready.catch(() => {});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listeners.has("browser://loaded")).toBe(false);

    broken = false;
    const broker = hub.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await expect(broker.ready).resolves.toBeUndefined();
    expect(listeners.has("browser://loaded")).toBe(true);
    // Only the dead event was re-registered.
    expect(listenCalls).toBe(BROWSER_NATIVE_EVENTS.length);
    broker.unsubscribe();
    ui.unsubscribe();
  });

  it("does not retry after the last subscriber left", async () => {
    vi.useFakeTimers();
    listenImpl = (name, cb) =>
      name === "browser://dialog" ? Promise.reject(new Error("ipc not ready")) : defaultListen(name, cb);
    const hub = new BrowserNativeEventHub();
    const sub = hub.subscribe(() => {});
    sub.ready.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(browserWarn).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(browserWarn).toHaveBeenCalledTimes(1);
    expect(listenCalls).toBe(BROWSER_NATIVE_EVENTS.length - 1);
  });
});
