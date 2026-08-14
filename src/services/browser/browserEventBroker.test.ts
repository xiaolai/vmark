// @vitest-environment node
// WI-N0.4 / WI-N2.2 — navigation ticket correlation and event-before-waiter safety
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserEventBroker, type BrowserNavigationEvent } from "./browserEventBroker";

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
// permits (and requires): it is an external module, not app state. Without it
// `start()` never runs, so the three native subscriptions, the payload adapter
// and `fromNative` were all unreachable.
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: (m: { payload: unknown }) => void) => {
    handlers.set(event, cb);
    return Promise.resolve(() => unlistened.push(event));
  },
}));
const handlers = new Map<string, (m: { payload: unknown }) => void>();
const unlistened: string[] = [];
const emit = (event: string, payload: unknown) => handlers.get(event)?.({ payload });

describe("BrowserEventBroker — native subscriptions", () => {
  afterEach(() => {
    handlers.clear();
    unlistened.length = 0;
  });

  it("publishes a navigated event carried in from the native side", async () => {
    const broker = new BrowserEventBroker();
    await broker.start();
    emit("browser://navigated", { tabId: "t1", navigationId: "nav-9", generation: 2, url: "https://x.test/" });
    expect(broker.latestNavigationId("t1")).toBe("nav-9");
    const seen = broker.wait("t1");
    emit("browser://loaded", { tabId: "t1", navigationId: "nav-9" });
    await expect(seen).resolves.toMatchObject({ kind: "loaded", tabId: "t1", navigationId: "nav-9" });
  });

  it("synthesises a navigation id when the payload omits one", async () => {
    // Older native builds emit no navigationId; the broker must still correlate.
    const broker = new BrowserEventBroker();
    await broker.start();
    emit("browser://navigated", { tabId: "t2", url: "https://y.test/" });
    expect(broker.latestNavigationId("t2")).toBe("legacy-t2");
  });

  it("carries loaded and load-failed through the same adapter", async () => {
    const broker = new BrowserEventBroker();
    await broker.start();
    emit("browser://navigated", { tabId: "t3", navigationId: "n1", url: "https://z.test/" });
    const loaded = broker.wait("t3");
    emit("browser://loaded", { tabId: "t3", navigationId: "n1" });
    await expect(loaded).resolves.toMatchObject({ kind: "loaded", tabId: "t3" });

    const broker2 = new BrowserEventBroker();
    await broker2.start();
    emit("browser://navigated", { tabId: "t4", navigationId: "n2", url: "https://w.test/" });
    const failed = broker2.wait("t4");
    emit("browser://load-failed", { tabId: "t4", navigationId: "n2", message: "boom" });
    await expect(failed).resolves.toMatchObject({ kind: "failed", tabId: "t4" });
  });

  it("ignores a payload whose tabId is not a string", async () => {
    const broker = new BrowserEventBroker();
    await broker.start();
    expect(() => emit("browser://navigated", { tabId: 42 })).not.toThrow();
    expect(broker.latestNavigationId("42")).toBeUndefined();
  });

  it("start() is idempotent and stop() detaches every listener", async () => {
    const broker = new BrowserEventBroker();
    await Promise.all([broker.start(), broker.start()]);
    await broker.stop();
    expect(unlistened).toHaveLength(3);
  });
});
