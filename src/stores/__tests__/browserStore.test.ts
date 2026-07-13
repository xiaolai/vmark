// WI-1.6 — browser-tab hibernation: LRU live-webview cap + keep-alive exemption
import { describe, it, expect, beforeEach } from "vitest";
import { useBrowserStore, DEFAULT_MAX_LIVE } from "../browserStore";

const W = "main";

function reset() {
  useBrowserStore.setState({ liveTabs: {}, keepAlive: {}, maxLive: DEFAULT_MAX_LIVE });
}

beforeEach(reset);

describe("activate (live-webview LRU policy)", () => {
  it("keeps a tab live when under the cap", () => {
    const evicted = useBrowserStore.getState().activate(W, "a");
    expect(evicted).toEqual([]);
    expect(useBrowserStore.getState().isLive(W, "a")).toBe(true);
    expect(useBrowserStore.getState().liveCount(W)).toBe(1);
  });

  it("evicts the least-recently-used tab when the cap is exceeded", () => {
    useBrowserStore.setState({ maxLive: 3 });
    const { activate } = useBrowserStore.getState();
    activate(W, "a"); // LRU
    activate(W, "b");
    activate(W, "c");
    const evicted = activate(W, "d"); // 4th → evicts "a"
    expect(evicted).toEqual(["a"]);
    expect(useBrowserStore.getState().isLive(W, "a")).toBe(false);
    expect(useBrowserStore.getState().liveCount(W)).toBe(3);
    expect(useBrowserStore.getState().isLive(W, "d")).toBe(true);
  });

  it("re-activating a live tab moves it to most-recently-used (no eviction)", () => {
    useBrowserStore.setState({ maxLive: 3 });
    const { activate } = useBrowserStore.getState();
    activate(W, "a");
    activate(W, "b");
    activate(W, "c");
    activate(W, "a"); // touch a → now MRU; b is LRU
    const evicted = activate(W, "d"); // evicts b, not a
    expect(evicted).toEqual(["b"]);
    expect(useBrowserStore.getState().isLive(W, "a")).toBe(true);
    expect(useBrowserStore.getState().liveCount(W)).toBe(3);
  });

  it("scopes the cap per window", () => {
    useBrowserStore.setState({ maxLive: 1 });
    const { activate } = useBrowserStore.getState();
    activate("w1", "a");
    activate("w2", "b");
    expect(useBrowserStore.getState().isLive("w1", "a")).toBe(true);
    expect(useBrowserStore.getState().isLive("w2", "b")).toBe(true);
  });
});

describe("keep-alive exemption (AI-driven tabs)", () => {
  it("skips a keep-alive tab when choosing an eviction victim", () => {
    useBrowserStore.setState({ maxLive: 3 });
    const store = useBrowserStore.getState();
    store.setKeepAlive("a", true); // AI is driving "a"
    store.activate(W, "a"); // LRU but protected
    store.activate(W, "b");
    store.activate(W, "c");
    const evicted = store.activate(W, "d"); // must evict "b" (next non-protected LRU), not "a"
    expect(evicted).toEqual(["b"]);
    expect(useBrowserStore.getState().isLive(W, "a")).toBe(true);
  });

  it("exceeds the cap rather than evict a protected tab when all live tabs are protected", () => {
    useBrowserStore.setState({ maxLive: 2 });
    const store = useBrowserStore.getState();
    store.setKeepAlive("a", true);
    store.setKeepAlive("b", true);
    store.activate(W, "a");
    store.activate(W, "b");
    const evicted = store.activate(W, "c"); // can't evict a/b → keep all 3 live
    expect(evicted).toEqual([]);
    expect(useBrowserStore.getState().liveCount(W)).toBe(3);
  });

  it("clearing keep-alive lets the tab be evicted again", () => {
    useBrowserStore.setState({ maxLive: 2 });
    const store = useBrowserStore.getState();
    store.setKeepAlive("a", true);
    store.activate(W, "a");
    store.activate(W, "b");
    store.setKeepAlive("a", false);
    const evicted = store.activate(W, "c"); // "a" is now evictable and LRU
    expect(evicted).toEqual(["a"]);
  });

  it("clearing keep-alive rebalances an over-cap window at once (no waiting for the next activation)", () => {
    // Protection is what pushed the window over the cap; once it lifts, the
    // excess webviews must go — otherwise they stay live indefinitely.
    useBrowserStore.setState({ maxLive: 2 });
    const store = useBrowserStore.getState();
    store.setKeepAlive("a", true);
    store.setKeepAlive("b", true);
    store.activate(W, "a");
    store.activate(W, "b");
    store.activate(W, "c"); // 3 live: nothing was evictable (a/b protected, c just activated)
    expect(useBrowserStore.getState().liveCount(W)).toBe(3);

    const evicted = useBrowserStore.getState().setKeepAlive("a", false);

    expect(evicted).toEqual(["a"]); // the LRU tab, now unprotected
    expect(useBrowserStore.getState().liveCount(W)).toBe(2);
    expect(useBrowserStore.getState().isLive(W, "a")).toBe(false);
    expect(useBrowserStore.getState().isLive(W, "b")).toBe(true); // still protected
  });

  it("clearing keep-alive on a window that is within the cap evicts nothing", () => {
    useBrowserStore.setState({ maxLive: 3 });
    const store = useBrowserStore.getState();
    store.setKeepAlive("a", true);
    store.activate(W, "a");
    store.activate(W, "b");
    expect(useBrowserStore.getState().setKeepAlive("a", false)).toEqual([]);
    expect(useBrowserStore.getState().isLive(W, "a")).toBe(true);
  });

  it("setting keep-alive never evicts", () => {
    useBrowserStore.setState({ maxLive: 1 });
    const store = useBrowserStore.getState();
    store.activate(W, "a");
    expect(store.setKeepAlive("a", true)).toEqual([]);
    expect(useBrowserStore.getState().isLive(W, "a")).toBe(true);
  });

  it("rebalancing is scoped correctly across windows (each window keeps its own cap)", () => {
    useBrowserStore.setState({ maxLive: 1 });
    const store = useBrowserStore.getState();
    store.setKeepAlive("a", true);
    store.activate("w1", "a");
    store.activate("w1", "b"); // over cap in w1 ("a" protected)
    store.activate("w2", "c");

    const evicted = useBrowserStore.getState().setKeepAlive("a", false);

    expect(evicted).toEqual(["a"]);
    expect(useBrowserStore.getState().isLive("w2", "c")).toBe(true); // untouched
  });
});

describe("hibernate / removeTab / removeWindow", () => {
  it("hibernate makes a live tab not-live and returns whether it was live", () => {
    const store = useBrowserStore.getState();
    store.activate(W, "a");
    expect(store.hibernate(W, "a")).toBe(true);
    expect(useBrowserStore.getState().isLive(W, "a")).toBe(false);
    expect(useBrowserStore.getState().hibernate(W, "a")).toBe(false); // already hibernated
  });

  it("removeTab drops liveness + keep-alive for a closed tab", () => {
    const store = useBrowserStore.getState();
    store.setKeepAlive("a", true);
    store.activate(W, "a");
    store.removeTab(W, "a");
    expect(useBrowserStore.getState().isLive(W, "a")).toBe(false);
    expect(useBrowserStore.getState().isKeptAlive("a")).toBe(false);
  });

  it("removeWindow clears the window's live set", () => {
    const store = useBrowserStore.getState();
    store.activate(W, "a");
    store.activate(W, "b");
    store.removeWindow(W);
    expect(useBrowserStore.getState().liveCount(W)).toBe(0);
  });

  it("removeWindow drops keep-alive for the closed window's tabs (no permanent stale protection)", () => {
    const store = useBrowserStore.getState();
    store.setKeepAlive("a", true);
    store.activate(W, "a");
    store.removeWindow(W);
    expect(useBrowserStore.getState().isKeptAlive("a")).toBe(false);
  });

  it("removeWindow keeps protection for a tab still live in another window", () => {
    const store = useBrowserStore.getState();
    store.setKeepAlive("a", true);
    store.activate("w1", "a");
    store.activate("w2", "a");
    store.removeWindow("w1");
    expect(useBrowserStore.getState().isKeptAlive("a")).toBe(true);
  });
});
