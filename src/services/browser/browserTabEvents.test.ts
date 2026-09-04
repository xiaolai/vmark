// @vitest-environment node
// Audit 2026-09-03 L-01 — browserTabEvents: the window-level mirror of native
// browser events, for every tab of this window whether or not its surface is mounted.
import { describe, it, expect, beforeEach, vi } from "vitest";

import type { TabNavHandlers } from "./browserNavEvents";

const handlers: { current: (() => TabNavHandlers) | null } = { current: null };
vi.mock("./browserNavEvents", () => ({
  subscribeBrowserNavEvents: (current: () => TabNavHandlers) => {
    handlers.current = current;
    return () => {
      handlers.current = null;
    };
  },
}));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));
const activate = vi.fn();
vi.mock("@/services/navigation/activateTabInFocusedPane", () => ({
  activateTabInFocusedPane: (...a: unknown[]) => activate(...a),
}));
const addOccluder = vi.fn();
const removeOccluder = vi.fn();
vi.mock("./browserOcclusion", () => ({
  browserOcclusion: {
    addOccluder: (...a: unknown[]) => addOccluder(...a),
    removeOccluder: (...a: unknown[]) => removeOccluder(...a),
  },
  OCCLUDER: { crash: "crash-overlay", dialog: "page-dialog" },
}));

import { useTabStore } from "@/stores/tabStore";
import { useBrowserUiStore } from "@/stores/browserUiStore";
import { startBrowserTabEvents } from "./browserTabEvents";

const WINDOW = "main";
const START = "https://start.example/";
/** A navigation id as the driver mints it: `nav-<tabId>-<sequence>` (registry_navigation.rs). */
const nav = (tabId: string, sequence: number) => `nav-${tabId}-${sequence}`;

/** A browser tab of this window. `createBrowserTab` reuses an existing tab with
 *  the same URL, so two distinct tabs need two distinct start pages. */
function seed(automationMode: "human" | "ai-sandbox" = "human", url = START): string {
  const tabId = useTabStore.getState().createBrowserTab(WINDOW, url, undefined, automationMode);
  useBrowserUiStore.getState().ensureEntry(tabId, url);
  return tabId;
}

function browserTab(tabId: string) {
  const tab = useTabStore.getState().tabs[WINDOW]?.find((t) => t.id === tabId);
  if (!tab || tab.kind !== "browser") throw new Error(`no browser tab ${tabId}`);
  return tab;
}

function h(): TabNavHandlers {
  if (!handlers.current) throw new Error("service not started");
  return handlers.current();
}

let stop: () => void = () => {};

beforeEach(() => {
  useTabStore.getState().removeWindow(WINDOW);
  useTabStore.getState().removeWindow("other");
  useBrowserUiStore.setState({ entries: {} });
  activate.mockClear();
  addOccluder.mockClear();
  removeOccluder.mockClear();
  stop();
  stop = startBrowserTabEvents();
});

describe("navigated", () => {
  it("moves the tab record and the omnibox to the committed page and starts the spinner", () => {
    const tabId = seed();
    h().onNavigated?.(tabId, "https://next.example/a", 3, false);

    expect(browserTab(tabId)).toMatchObject({ url: "https://next.example/a", generation: 3 });
    expect(useBrowserUiStore.getState().entries[tabId]).toMatchObject({
      urlInput: "https://next.example/a",
      loading: true,
      error: null,
      blockedPopup: null,
    });
  });

  it("ignores a tab that belongs to another window", () => {
    const foreign = useTabStore.getState().createBrowserTab("other", START);
    h().onNavigated?.(foreign, "https://next.example/", 1, false);

    const tab = useTabStore.getState().tabs.other?.find((t) => t.id === foreign);
    expect(tab).toMatchObject({ url: START });
    expect(useBrowserUiStore.getState().entries[foreign]).toBeUndefined();
  });
});

describe("loaded", () => {
  it("stops the spinner and retitles the tab record with the page's title", () => {
    const tabId = seed();
    h().onNavigated?.(tabId, "https://next.example/a", 3, false);
    h().onLoaded?.(tabId, "https://next.example/a", "Next — Home", 3);

    expect(useBrowserUiStore.getState().entries[tabId]?.loading).toBe(false);
    expect(browserTab(tabId)).toMatchObject({ url: "https://next.example/a", title: "Next — Home" });
  });

  // The strip label read `duckduckgo.com` over a fixture at 127.0.0.1: the record's
  // title was written once at creation and never again.
  it("names a title-less page by its host, not by the tab's first URL", () => {
    const tabId = seed();
    expect(browserTab(tabId).title).toBe(START);
    h().onNavigated?.(tabId, "http://127.0.0.1:59180/second", 2, false);
    h().onLoaded?.(tabId, "http://127.0.0.1:59180/second", "", 2);

    expect(browserTab(tabId).title).toBe("127.0.0.1:59180");
  });

  it("releases the crash overlay once a page loads cleanly", () => {
    const tabId = seed();
    h().onCrashed?.(tabId, "manual");
    expect(useBrowserUiStore.getState().entries[tabId]?.crash).toEqual({ action: "manual" });
    expect(addOccluder).toHaveBeenCalledWith(tabId, "crash-overlay");

    h().onLoaded?.(tabId, START, "Back", 1);
    expect(useBrowserUiStore.getState().entries[tabId]?.crash).toBeNull();
    expect(removeOccluder).toHaveBeenCalledWith(tabId, "crash-overlay");
  });
});

describe("dialog and popup", () => {
  it("brings a background tab forward for a page dialog and freezes its view", () => {
    const active = seed();
    const background = seed("human", "https://background.example/");
    expect(background).not.toBe(active);
    useTabStore.getState().setActiveTab(WINDOW, active);

    h().onDialog?.(background, { kind: "confirm", message: "Leave?", id: 7 });

    expect(useBrowserUiStore.getState().entries[background]?.dialog).toEqual({
      kind: "confirm",
      message: "Leave?",
      id: 7,
    });
    expect(addOccluder).toHaveBeenCalledWith(background, "page-dialog");
    expect(activate).toHaveBeenCalledWith(WINDOW, background);
  });

  it("does not re-activate the tab that is already on screen", () => {
    const tabId = seed();
    useTabStore.getState().setActiveTab(WINDOW, tabId);
    h().onDialog?.(tabId, { kind: "alert", message: "Hi" });
    expect(activate).not.toHaveBeenCalled();
  });

  it("records a blocked popup on its tab so the chrome can offer it", () => {
    const tabId = seed("ai-sandbox");
    h().onPopupBlocked?.(tabId, "https://popup.example/x");
    expect(useBrowserUiStore.getState().entries[tabId]?.blockedPopup).toMatchObject({
      url: "https://popup.example/x",
    });
  });
});

// Audit 2026-09-03 round 3 (#87), round 4: a failure is judged by the ORDER of the
// navigation ids this service has itself seen — never against the broker's
// `latestNavigationId`, which the same failure event rewrites, so the verdict
// depended on which listener the runtime called first. Ids are `nav-<tabId>-<n>`
// from one monotonic counter per tab (registry_navigation.rs); a failure below the
// highest sequence this tab has shown is about a page nobody is looking at. See
// browserTabEvents.ordering.test.ts for both listener orders through the real hub.
describe("failed", () => {
  const error = (tabId: string) => useBrowserUiStore.getState().entries[tabId]?.error;

  it("shows a failure for the current navigation", () => {
    const tabId = seed();
    h().onNavigated?.(tabId, "https://next.example/a", 1, false, nav(tabId, 1));
    h().onFailed?.(tabId, "offline", nav(tabId, 1));
    expect(useBrowserUiStore.getState().entries[tabId]).toMatchObject({ error: "offline", loading: false });
  });

  it("ignores a failure for a navigation the tab has since superseded", () => {
    const tabId = seed();
    h().onNavigated?.(tabId, "https://first.example/", 1, false, nav(tabId, 1));
    h().onNavigated?.(tabId, "https://second.example/", 2, false, nav(tabId, 2));
    h().onLoaded?.(tabId, "https://second.example/", "Second", 2, nav(tabId, 2));

    h().onFailed?.(tabId, "cancelled", nav(tabId, 1));

    expect(useBrowserUiStore.getState().entries[tabId]).toMatchObject({
      error: null,
      loading: false,
      urlInput: "https://second.example/",
    });
    // The current navigation's failure is still reported.
    h().onFailed?.(tabId, "boom", nav(tabId, 2));
    expect(error(tabId)).toBe("boom");
  });

  // DNS, TLS, a refused connection: the load never commits, so its id never appears
  // in a `navigated` — it is the common real failure, and it must show.
  it("shows a failure whose navigation never committed (a provisional failure)", () => {
    const tabId = seed();
    h().onNavigated?.(tabId, "https://first.example/", 1, false, nav(tabId, 1));
    h().onFailed?.(tabId, "could not resolve host", nav(tabId, 2));
    expect(error(tabId)).toBe("could not resolve host");
  });

  it("shows a failure that carries no ticket (an older driver)", () => {
    const tabId = seed();
    h().onNavigated?.(tabId, "https://first.example/", 1, false, nav(tabId, 1));
    h().onFailed?.(tabId, "legacy failure");
    expect(error(tabId)).toBe("legacy failure");
  });

  it("a redirect chain re-committing under one ticket does not supersede that ticket", () => {
    const tabId = seed();
    h().onNavigated?.(tabId, "https://short.example/x", 1, false, nav(tabId, 1));
    h().onNavigated?.(tabId, "https://long.example/target", 2, true, nav(tabId, 1));
    h().onFailed?.(tabId, "reset by peer", nav(tabId, 1));
    expect(error(tabId)).toBe("reset by peer");
  });

  // Round 4: the round-3 ledger held only COMMITTED ids. A provisional navigation
  // never commits, so its id was never in the ledger, and a LATE report of its
  // failure could paint an error over the page that loaded fine after it.
  it("ignores a late failure from a provisional navigation the tab has since moved past", () => {
    const tabId = seed();
    h().onNavigated?.(tabId, "https://first.example/", 1, false, nav(tabId, 1));
    h().onLoaded?.(tabId, "https://first.example/", "First", 1, nav(tabId, 1));
    // nav-2 never commits (DNS failed). Shown: it is the newest thing this tab did.
    h().onFailed?.(tabId, "could not resolve host", nav(tabId, 2));
    expect(error(tabId)).toBe("could not resolve host");
    // The user moves on; nav-3 commits and loads, which clears the overlay.
    h().onNavigated?.(tabId, "https://third.example/", 2, false, nav(tabId, 3));
    h().onLoaded?.(tabId, "https://third.example/", "Third", 2, nav(tabId, 3));
    expect(error(tabId)).toBeNull();
    // A second, late report about nav-2 must not paint over Third.
    h().onFailed?.(tabId, "cancelled", nav(tabId, 2));
    expect(useBrowserUiStore.getState().entries[tabId]).toMatchObject({
      error: null,
      urlInput: "https://third.example/",
    });
  });

  it("a provisional failure is the newest thing shown: an older navigation's late failure cannot replace it", () => {
    const tabId = seed();
    h().onNavigated?.(tabId, "https://first.example/", 1, false, nav(tabId, 1));
    h().onFailed?.(tabId, "could not resolve host", nav(tabId, 2));
    h().onFailed?.(tabId, "cancelled", nav(tabId, 1));
    expect(error(tabId)).toBe("could not resolve host");
  });

  // Round 4: the round-3 ledger was an eight-entry ring, so the ninth navigation
  // evicted an id whose late failure then looked "unknown" — and showed.
  it("ignores a late failure from twenty navigations ago", () => {
    const tabId = seed();
    for (let n = 1; n <= 21; n++) {
      h().onNavigated?.(tabId, `https://page${n}.example/`, n, false, nav(tabId, n));
    }
    h().onLoaded?.(tabId, "https://page21.example/", "Twenty-one", 21, nav(tabId, 21));
    h().onFailed?.(tabId, "cancelled", nav(tabId, 1));
    expect(useBrowserUiStore.getState().entries[tabId]).toMatchObject({
      error: null,
      urlInput: "https://page21.example/",
    });
    h().onFailed?.(tabId, "boom", nav(tabId, 21));
    expect(error(tabId)).toBe("boom");
  });

  // An id that carries no order for this tab falls back to the pre-order rule: show it.
  it.each([
    ["an older driver's stand-in", (tabId: string) => `legacy-${tabId}`],
    ["a malformed ticket", () => "nav-1"],
    ["another tab's ticket", () => "nav-tab-other-9"],
  ])("shows a failure whose id carries no order for this tab (%s), and leaves the order alone", (_label, id) => {
    const tabId = seed();
    h().onNavigated?.(tabId, "https://first.example/", 1, false, nav(tabId, 1));
    h().onNavigated?.(tabId, "https://second.example/", 2, false, nav(tabId, 2));
    h().onFailed?.(tabId, "unordered failure", id(tabId));
    expect(error(tabId)).toBe("unordered failure");
    // The order is untouched: nav-1 is still superseded and a newer failure still shows.
    h().onNavigated?.(tabId, "https://third.example/", 3, false, nav(tabId, 3)); // clears the overlay
    h().onFailed?.(tabId, "late", nav(tabId, 1));
    expect(error(tabId)).toBeNull();
    h().onFailed?.(tabId, "current", nav(tabId, 3));
    expect(error(tabId)).toBe("current");
  });
});

// Audit 2026-09-03 round 3 (#154): every page-state write is STAMPED with the event's
// generation, so the store itself — not only this handler — can refuse a late one.
describe("generation stamps", () => {
  it("stamps the entry with the committed generation on navigated, loaded and history", () => {
    const tabId = seed();
    expect(useBrowserUiStore.getState().entries[tabId]?.generation).toBe(0);
    h().onNavigated?.(tabId, "https://next.example/a", 3, false);
    expect(useBrowserUiStore.getState().entries[tabId]?.generation).toBe(3);
    h().onLoaded?.(tabId, "https://next.example/a", "Next", 4);
    expect(useBrowserUiStore.getState().entries[tabId]?.generation).toBe(4);
    h().onHistoryChanged?.(tabId, true, false, 5);
    expect(useBrowserUiStore.getState().entries[tabId]).toMatchObject({ generation: 5, canGoBack: true });
  });

  it("a stale loaded event cannot rewrite the omnibox or stop the spinner of the current page", () => {
    const tabId = seed();
    h().onNavigated?.(tabId, "https://second.example/", 2, false);
    h().onLoaded?.(tabId, "https://first.example/", "First", 1);
    expect(useBrowserUiStore.getState().entries[tabId]).toMatchObject({
      urlInput: "https://second.example/",
      loading: true,
      generation: 2,
    });
    expect(browserTab(tabId).title).not.toBe("First");
  });

  it("an unstamped user edit still applies after a stamped event", () => {
    const tabId = seed();
    h().onNavigated?.(tabId, "https://second.example/", 2, false);
    useBrowserUiStore.getState().setUrlInput(tabId, "https://typing.exa");
    expect(useBrowserUiStore.getState().entries[tabId]).toMatchObject({
      urlInput: "https://typing.exa",
      generation: 2,
    });
  });
});
