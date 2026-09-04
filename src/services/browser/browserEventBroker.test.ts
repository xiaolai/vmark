// @vitest-environment node
// WI-N0.4 / WI-N2.2 — navigation ticket correlation and event-before-waiter safety
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserEventBroker, type BrowserNavigationEvent } from "./browserEventBroker";
import { BrowserNativeEventHub } from "./browserNativeEvents";
import { BROWSER_NATIVE_EVENTS } from "./browserNativeEventDecoder";

function loaded(navigationId: string): BrowserNavigationEvent {
  return {
    kind: "loaded",
    tabId: "t1",
    navigationId,
    generation: 3,
    url: "https://example.com/",
    title: "Example",
  };
}

describe("BrowserEventBroker", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves a waiter from an event that was published before waiting", async () => {
    const broker = new BrowserEventBroker();
    broker.publish(loaded("nav-1"));
    await expect(broker.wait("t1", "nav-1", 100)).resolves.toMatchObject({ kind: "loaded" });
  });

  it("resolves a waiter when the matching event arrives later", async () => {
    const broker = new BrowserEventBroker();
    const result = broker.wait("t1", "nav-1", 100);
    broker.publish(loaded("nav-1"));
    await expect(result).resolves.toMatchObject({ kind: "loaded", navigationId: "nav-1" });
  });

  it("marks an older waiter superseded when a newer navigation begins", async () => {
    const broker = new BrowserEventBroker();
    const result = broker.wait("t1", "nav-1", 100);
    broker.publish({ kind: "navigated", tabId: "t1", navigationId: "nav-2", generation: 4, url: "https://b.example/" });
    await expect(result).resolves.toMatchObject({ kind: "superseded", navigationId: "nav-1" });
  });

  it("times out with a bounded result", async () => {
    vi.useFakeTimers();
    const broker = new BrowserEventBroker();
    const result = broker.wait("t1", "nav-1", 100);
    vi.advanceTimersByTime(100);
    await expect(result).resolves.toMatchObject({ kind: "timeout", navigationId: "nav-1" });
  });

  it("drops events for another tab and bounds terminal history", async () => {
    const broker = new BrowserEventBroker({ maxTerminalsPerTab: 1 });
    broker.publish({ ...loaded("nav-other"), tabId: "t2" });
    broker.publish(loaded("nav-1"));
    broker.publish(loaded("nav-2"));
    await expect(broker.wait("t1", "nav-1", 100)).resolves.toMatchObject({ kind: "superseded" });
    await expect(broker.wait("t1", "nav-2", 100)).resolves.toMatchObject({ kind: "loaded" });
  });

  it("cancels waiters and clears stale tickets during teardown", async () => {
    const broker = new BrowserEventBroker();
    const result = broker.wait("t1", "nav-1", 100);
    broker.cancelPending();
    await expect(result).resolves.toMatchObject({ kind: "disabled", navigationId: "nav-1" });
    await expect(broker.wait("t1")).resolves.toMatchObject({ kind: "idle" });
  });

  it("clears one tab when its active native surface unmounts", async () => {
    const broker = new BrowserEventBroker();
    const result = broker.wait("t1", "nav-1", 100);
    broker.publish({ kind: "navigated", tabId: "t1", navigationId: "nav-1", generation: 1, url: "https://example.com/" });
    broker.cancelTab("t1");
    await expect(result).resolves.toMatchObject({ kind: "unmounted", navigationId: "nav-1" });
    await expect(broker.wait("t1")).resolves.toMatchObject({ kind: "idle" });
    expect(broker.isLoading("t1")).toBeUndefined();
  });
});

// `listen` is the Tauri boundary — mocking it is what the mock-boundary rule
// permits (and requires): it is an external module, not app state. The broker
// reaches it through the shared native-event hub (round 3, #80), so each test
// hands its broker a FRESH hub — the process-wide one would keep the previous
// test's registration alive against a map this file resets.
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: (m: { payload: unknown }) => void) => listenImpl(event, cb),
}));
const handlers = new Map<string, (m: { payload: unknown }) => void>();
const unlistened: string[] = [];
const registerListener = (event: string, cb: (m: { payload: unknown }) => void) => {
  handlers.set(event, cb);
  return Promise.resolve(() => unlistened.push(event));
};
let listenImpl: typeof registerListener = registerListener;
const emit = (event: string, payload: unknown) => handlers.get(event)?.({ payload });

describe("BrowserEventBroker — native subscriptions", () => {
  let hub: BrowserNativeEventHub;
  beforeEach(() => {
    hub = new BrowserNativeEventHub();
    listenImpl = registerListener;
  });
  afterEach(() => {
    handlers.clear();
    unlistened.length = 0;
    vi.useRealTimers();
  });

  it("publishes a navigated event carried in from the native side", async () => {
    const broker = new BrowserEventBroker({ source: hub });
    await broker.start();
    emit("browser://navigated", { tabId: "t1", navigationId: "nav-9", generation: 2, url: "https://x.test/" });
    expect(broker.latestNavigationId("t1")).toBe("nav-9");
    const seen = broker.wait("t1");
    emit("browser://loaded", { tabId: "t1", navigationId: "nav-9", generation: 2, url: "https://x.test/" });
    await expect(seen).resolves.toMatchObject({ kind: "loaded", tabId: "t1", navigationId: "nav-9" });
  });

  it("synthesises a navigation id when the payload omits one", async () => {
    // Older native builds emit no navigationId; the broker must still correlate.
    const broker = new BrowserEventBroker({ source: hub });
    await broker.start();
    emit("browser://navigated", { tabId: "t2", url: "https://y.test/", generation: 1 });
    expect(broker.latestNavigationId("t2")).toBe("legacy-t2");
  });

  it("carries loaded and load-failed through the same decoder", async () => {
    const broker = new BrowserEventBroker({ source: hub });
    await broker.start();
    emit("browser://navigated", { tabId: "t3", navigationId: "n1", url: "https://z.test/", generation: 1 });
    const loaded = broker.wait("t3");
    emit("browser://loaded", { tabId: "t3", navigationId: "n1", url: "https://z.test/", generation: 1 });
    await expect(loaded).resolves.toMatchObject({ kind: "loaded", tabId: "t3", url: "https://z.test/" });

    emit("browser://navigated", { tabId: "t4", navigationId: "n2", url: "https://w.test/", generation: 1 });
    const failed = broker.wait("t4");
    emit("browser://load-failed", { tabId: "t4", navigationId: "n2", message: "boom" });
    await expect(failed).resolves.toMatchObject({ kind: "failed", tabId: "t4", message: "boom" });
  });

  // Round 3 (#80): the broker used to decode payloads itself, defaulting a missing
  // generation to 0 and a missing url to "" — the values #81 exists to refuse. One
  // decoder means one answer: a malformed terminal is dropped for the waiters too.
  it("ignores a malformed terminal through the shared decoder — the navigation stays in flight", async () => {
    const broker = new BrowserEventBroker({ source: hub });
    await broker.start();
    emit("browser://navigated", { tabId: "t5", navigationId: "n5", url: "https://v.test/", generation: 1 });
    emit("browser://loaded", { tabId: "t5", navigationId: "n5" }); // no url, no generation
    expect(broker.isLoading("t5")).toBe(true);
    emit("browser://navigated", { tabId: "t5", navigationId: "n6" }); // no url, no generation
    expect(broker.latestNavigationId("t5")).toBe("n5");
  });

  it("ignores a payload whose tabId is not a string", async () => {
    const broker = new BrowserEventBroker({ source: hub });
    await broker.start();
    expect(() => emit("browser://navigated", { tabId: 42 })).not.toThrow();
    expect(broker.latestNavigationId("42")).toBeUndefined();
  });

  it("start() is idempotent and stop() detaches every native listener the hub registered", async () => {
    const broker = new BrowserEventBroker({ source: hub });
    await Promise.all([broker.start(), broker.start()]);
    await broker.stop();
    expect(unlistened).toHaveLength(BROWSER_NATIVE_EVENTS.length);
    expect(new Set(unlistened)).toEqual(new Set(BROWSER_NATIVE_EVENTS));
  });

  it("start() rejects when a native registration gives up, and a later start() retries it", async () => {
    vi.useFakeTimers();
    let broken = true;
    listenImpl = (event, cb) =>
      event === "browser://loaded" && broken ? Promise.reject(new Error("ipc down")) : registerListener(event, cb);
    const broker = new BrowserEventBroker({ source: hub });
    const first = broker.start().then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(first).resolves.toBe("ipc down");
    // A failed start leaves nothing registered behind it.
    expect(unlistened).toHaveLength(BROWSER_NATIVE_EVENTS.length - 1);

    broken = false;
    await broker.start();
    emit("browser://navigated", { tabId: "t6", navigationId: "n7", url: "https://u.test/", generation: 1 });
    const seen = broker.wait("t6");
    emit("browser://loaded", { tabId: "t6", navigationId: "n7", url: "https://u.test/", generation: 1 });
    await expect(seen).resolves.toMatchObject({ kind: "loaded", navigationId: "n7" });
  });
});
