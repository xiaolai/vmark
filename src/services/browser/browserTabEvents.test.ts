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
