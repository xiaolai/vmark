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
