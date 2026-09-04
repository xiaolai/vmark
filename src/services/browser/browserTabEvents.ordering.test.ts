// @vitest-environment node
// Audit 2026-09-03 round 3 (#87) — the failure verdict is independent of listener
// registration order. The broker and the window-level tab-events service both
// consume `browser://load-failed` through the shared hub; the broker adopts the
// failing id as its `latestNavigationId`, so a handler that compared against the
// broker accepted or ignored a superseded failure depending on which subscriber
// happened to run first. This drives real events through the real hub to a real
// broker and the real service, in BOTH orders.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
let listenCalls = 0;
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: Listener) => {
    listenCalls += 1;
    listeners.set(name, cb);
    return Promise.resolve(() => listeners.delete(name));
  },
}));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));
vi.mock("@/services/navigation/activateTabInFocusedPane", () => ({
  activateTabInFocusedPane: vi.fn(),
}));
vi.mock("./browserOcclusion", () => ({
  browserOcclusion: { addOccluder: vi.fn(), removeOccluder: vi.fn() },
  OCCLUDER: { crash: "crash-overlay", dialog: "page-dialog" },
}));

import { useTabStore } from "@/stores/tabStore";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { browserEventBroker } from "./browserEventBroker";
import { startBrowserTabEvents } from "./browserTabEvents";

const WINDOW = "main";

function emit(name: string, payload: unknown) {
  listeners.get(name)?.({ payload });
}

let stopTabEvents: () => void = () => {};

beforeEach(() => {
  useTabStore.getState().removeWindow(WINDOW);
  useBrowserUiStore.setState({ entries: {} });
  listeners.clear();
  listenCalls = 0;
});
afterEach(async () => {
  stopTabEvents();
  stopTabEvents = () => {};
  await browserEventBroker.stop();
});

type Order = "broker first" | "tab events first";
async function startInOrder(order: Order): Promise<void> {
  if (order === "broker first") {
    await browserEventBroker.start();
    stopTabEvents = startBrowserTabEvents();
  } else {
    stopTabEvents = startBrowserTabEvents();
    await browserEventBroker.start();
  }
}

describe.each<Order>(["broker first", "tab events first"])("with the %s", (order) => {
  it("ignores a failure for a superseded navigation, and still shows one for the current page", async () => {
    const tabId = useTabStore.getState().createBrowserTab(WINDOW, "https://start.example/");
    useBrowserUiStore.getState().ensureEntry(tabId, "https://start.example/");
    await startInOrder(order);
    // One native registration per event, however many subscribers.
    expect(listenCalls).toBe(6);

    emit("browser://navigated", { tabId, url: "https://first.example/", generation: 1, navigationId: "nav-1" });
    emit("browser://navigated", { tabId, url: "https://second.example/", generation: 2, navigationId: "nav-2" });
    emit("browser://loaded", { tabId, url: "https://second.example/", title: "Second", generation: 2, navigationId: "nav-2" });
    // The broker has adopted nav-1's failure as "latest" by the time (or before) the
    // service sees it — the verdict must not depend on that.
    emit("browser://load-failed", { tabId, message: "cancelled", navigationId: "nav-1" });

    expect(useBrowserUiStore.getState().entries[tabId]).toMatchObject({
      error: null,
      loading: false,
      urlInput: "https://second.example/",
      generation: 2,
    });
    expect(browserEventBroker.latestNavigationId(tabId)).toBe("nav-1");

    emit("browser://load-failed", { tabId, message: "boom", navigationId: "nav-2" });
    expect(useBrowserUiStore.getState().entries[tabId]?.error).toBe("boom");
  });

  it("shows a provisional failure that never committed", async () => {
    const tabId = useTabStore.getState().createBrowserTab(WINDOW, "https://start.example/");
    useBrowserUiStore.getState().ensureEntry(tabId, "https://start.example/");
    await startInOrder(order);

    emit("browser://navigated", { tabId, url: "https://first.example/", generation: 1, navigationId: "nav-1" });
    emit("browser://loaded", { tabId, url: "https://first.example/", title: "First", generation: 1, navigationId: "nav-1" });
    emit("browser://load-failed", { tabId, message: "could not resolve host", navigationId: "nav-2" });

    expect(useBrowserUiStore.getState().entries[tabId]?.error).toBe("could not resolve host");
    // And the broker settles the ticket for an MCP waiter the same way.
    await expect(browserEventBroker.wait(tabId, "nav-2", 100)).resolves.toMatchObject({ kind: "failed" });
  });
});
