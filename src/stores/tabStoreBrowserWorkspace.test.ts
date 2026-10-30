// @vitest-environment node
/**
 * tabStoreBrowserWorkspace — browser tab and page creation: the canonical url,
 * reuse-by-url for "New Browser Tab", a fresh page for "+", activation, and the
 * activation announcement every activeTabId write owes the bus.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrowserPageAction, createBrowserTabAction } from "./tabStoreBrowserWorkspace";
import { onTabActivated } from "./tabActivationBus";
import type { Tab } from "./tabStoreTypes";

type State = {
  tabs: Record<string, Tab[]>;
  activeTabId: Record<string, string | null>;
  lastActiveBrowserPageId: Record<string, string | null>;
};

let state: State;
const set = (updater: (s: State) => Partial<State>) => {
  state = { ...state, ...updater(state) };
};
let activations: Array<[string, string | null]>;
let unsubscribe: () => void;

beforeEach(() => {
  state = { tabs: {}, activeTabId: {}, lastActiveBrowserPageId: {} };
  activations = [];
  unsubscribe = onTabActivated((w, id) => activations.push([w, id]));
});

afterEach(() => unsubscribe());

describe("createBrowserTabAction", () => {
  it("appends a canonical browser tab, activates it and announces the activation", () => {
    const id = createBrowserTabAction(set, "main", "https://Example.com", undefined, "human");
    const tab = state.tabs.main[0];
    expect(tab).toMatchObject({ kind: "browser", id, url: "https://example.com/", persistPolicy: "restore-human" });
    expect(state.activeTabId.main).toBe(id);
    expect(state.lastActiveBrowserPageId.main).toBe(id);
    expect(activations).toEqual([["main", id]]);
  });

  it("reuses an existing tab for the same url and mode instead of adding one", () => {
    const first = createBrowserTabAction(set, "main", "https://example.com/", undefined, "human");
    createBrowserPageAction(set, "main", "https://other.com/", undefined, "human");
    const again = createBrowserTabAction(set, "main", "https://example.com", undefined, "human");
    expect(again).toBe(first);
    expect(state.tabs.main).toHaveLength(2);
    expect(state.activeTabId.main).toBe(first);
    expect(activations.at(-1)).toEqual(["main", first]);
  });

  it("does not reuse a tab of another automation mode", () => {
    const human = createBrowserTabAction(set, "main", "https://example.com/", undefined, "human");
    const ai = createBrowserTabAction(set, "main", "https://example.com/", undefined, "ai-sandbox");
    expect(ai).not.toBe(human);
    expect(state.tabs.main.find((t) => t.id === ai)).toMatchObject({ persistPolicy: "transient-ai" });
  });

  it("keeps windows apart", () => {
    const a = createBrowserTabAction(set, "main", "https://example.com/", undefined, "human");
    const b = createBrowserTabAction(set, "doc-2", "https://example.com/", undefined, "human");
    expect(b).not.toBe(a);
    expect(state.tabs.main).toHaveLength(1);
    expect(state.tabs["doc-2"]).toHaveLength(1);
  });

  it("keeps a non-navigable url as written, so the tab still opens", () => {
    createBrowserTabAction(set, "main", "about:blank", "Blank", "human");
    expect(state.tabs.main[0]).toMatchObject({ url: "about:blank", title: "Blank" });
  });
});

describe("createBrowserPageAction", () => {
  it("always appends a fresh page, even for a url already open", () => {
    const first = createBrowserPageAction(set, "main", "https://example.com/", undefined, "human");
    const second = createBrowserPageAction(set, "main", "https://example.com/", undefined, "human");
    expect(second).not.toBe(first);
    expect(state.tabs.main.map((t) => t.id)).toEqual([first, second]);
    expect(state.activeTabId.main).toBe(second);
    expect(activations).toEqual([["main", first], ["main", second]]);
  });
});
