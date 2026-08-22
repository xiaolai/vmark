// @vitest-environment node
//
// WI-TNAV0.1 / WI-TNAV0.2 — the activation bus announces EVERY activation.
//
// The bus's own header claims it is the seam "no caller can skip", and
// paneStore depends on that claim to converge an open split. It was not true:
// `createBrowserTab` and `createBrowserPage` delegate to `addBrowserPage`,
// which wrote `activeTabId` directly and never announced. The cost was
// invisible in both directions — no MRU could see a browser activation, and
// paneStore silently skipped those activations too.
//
// The classification test at the bottom is the part that keeps this fixed: a
// new tabStore action cannot be added without deciding, in writing, whether it
// activates.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabStore } from "./tabStore";
import { onTabActivated, notifyTabActivated, withActivationOrigin } from "./tabActivationBus";

const WINDOW = "main";

function resetTabStore(): void {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    lastActiveBrowserPageId: {},
    untitledCounter: 0,
  });
}

beforeEach(() => {
  resetTabStore();
});

describe("notifyTabActivated", () => {
  it("defaults the origin to 'user' so existing call sites are unchanged", () => {
    const seen = vi.fn();
    const off = onTabActivated(seen);
    notifyTabActivated(WINDOW, "tab-1");
    off();
    expect(seen).toHaveBeenCalledWith(WINDOW, "tab-1", "user");
  });

  it("passes a non-default origin through to listeners", () => {
    const seen = vi.fn();
    const off = onTabActivated(seen);
    notifyTabActivated(WINDOW, "tab-1", "restore");
    notifyTabActivated(WINDOW, "tab-2", "background");
    off();
    expect(seen).toHaveBeenNthCalledWith(1, WINDOW, "tab-1", "restore");
    expect(seen).toHaveBeenNthCalledWith(2, WINDOW, "tab-2", "background");
  });
});

describe("browser activations reach the bus (WI-TNAV0.1)", () => {
  it("announces when createBrowserTab activates a new page", () => {
    const seen = vi.fn();
    const off = onTabActivated(seen);
    const id = useTabStore.getState().createBrowserTab(WINDOW, "https://one.example", "One");
    off();

    expect(useTabStore.getState().activeTabId[WINDOW]).toBe(id);
    expect(seen).toHaveBeenCalledWith(WINDOW, id, "user");
  });

  it("announces when createBrowserPage activates a new page", () => {
    const seen = vi.fn();
    const off = onTabActivated(seen);
    const id = useTabStore.getState().createBrowserPage(WINDOW, "https://two.example", "Two");
    off();

    expect(useTabStore.getState().activeTabId[WINDOW]).toBe(id);
    expect(seen).toHaveBeenCalledWith(WINDOW, id, "user");
  });

  it("announces the REUSED id when createBrowserTab dedupes onto an open page", () => {
    // The dedup branch is its own `activeTabId` write and its own bypass:
    // it activates an existing page rather than appending one.
    const first = useTabStore.getState().createBrowserTab(WINDOW, "https://one.example", "One");
    useTabStore.getState().createBrowserPage(WINDOW, "https://two.example", "Two");

    const seen = vi.fn();
    const off = onTabActivated(seen);
    const again = useTabStore.getState().createBrowserTab(WINDOW, "https://one.example", "One");
    off();

    expect(again).toBe(first);
    expect(useTabStore.getState().activeTabId[WINDOW]).toBe(first);
    expect(seen).toHaveBeenCalledWith(WINDOW, first, "user");
  });

  it("leaves activeTabId and the announcement in agreement", () => {
    // The invariant the bus exists to uphold, asserted directly: whatever the
    // store ends up pointing at is what listeners were told.
    let announced: string | null | undefined;
    const off = onTabActivated((_w, tabId) => {
      announced = tabId;
    });
    useTabStore.getState().createTab(WINDOW, null);
    useTabStore.getState().createBrowserPage(WINDOW, "https://three.example", "Three");
    off();

    expect(announced).toBe(useTabStore.getState().activeTabId[WINDOW]);
  });
});

describe("every tabStore action is classified (the guard)", () => {
  // Adding an action to neither set fails this test. That is the point: the
  // original defect was an action nobody had classified either way.
  const ACTIVATES = [
    "createTab",
    "createTransferredTab",
    "createBrowserTab",
    "createBrowserPage",
    "setActiveTab",
    "closeTab", // picks a neighbour after removal
    "detachTab", // same, via the removal path
  ];

  const DOES_NOT_ACTIVATE = [
    "updateBrowserTab",
    "setTabEditingEnabled",
    "setTabActiveSchemaId",
    "setTabViewMode",
    "setTabFormatId",
    "updateTabPath",
    "updateTabTitle",
    "togglePin",
    "recomputeAllFormatIds",
    "restoreTab", // appends WITHOUT activating; the reopen service owns that
    "reorderTabs",
    "getTabsByWindow",
    "getActiveTab",
    "findTabByPath",
    "findTabById",
    "getAllOpenFilePaths",
    "removeWindow",
  ];

  it("covers the store's real action surface", () => {
    const actual = Object.entries(useTabStore.getState())
      .filter(([, value]) => typeof value === "function")
      .map(([key]) => key)
      .sort();

    expect(actual).toEqual([...ACTIVATES, ...DOES_NOT_ACTIVATE].sort());
  });

  it("announces for every action classified as activating", () => {
    // Drives each activating action for real and requires an announcement.
    const invoke: Record<string, () => void> = {
      createTab: () => useTabStore.getState().createTab(WINDOW, null),
      createTransferredTab: () =>
        useTabStore.getState().createTransferredTab(WINDOW, {
          id: `transferred-${Math.random()}`,
          title: "Transferred",
          filePath: null,
          isPinned: false,
        } as Parameters<ReturnType<typeof useTabStore.getState>["createTransferredTab"]>[1]),
      createBrowserTab: () =>
        useTabStore.getState().createBrowserTab(WINDOW, `https://a-${Math.random()}.example`),
      createBrowserPage: () =>
        useTabStore.getState().createBrowserPage(WINDOW, `https://b-${Math.random()}.example`),
      setActiveTab: () => {
        const id = useTabStore.getState().createTab(WINDOW, null);
        useTabStore.getState().setActiveTab(WINDOW, id);
      },
      closeTab: () => {
        const keep = useTabStore.getState().createTab(WINDOW, null);
        const doomed = useTabStore.getState().createTab(WINDOW, null);
        expect(keep).not.toBe(doomed);
        useTabStore.getState().closeTab(WINDOW, doomed);
      },
      detachTab: () => {
        useTabStore.getState().createTab(WINDOW, null);
        const moved = useTabStore.getState().createTab(WINDOW, null);
        useTabStore.getState().detachTab(WINDOW, moved);
      },
    };

    expect(Object.keys(invoke).sort()).toEqual([...ACTIVATES].sort());

    for (const name of ACTIVATES) {
      resetTabStore();
      const seen = vi.fn();
      const off = onTabActivated(seen);
      invoke[name]();
      off();
      expect(seen, `${name} must announce on the activation bus`).toHaveBeenCalled();
    }
  });
});

describe("withActivationOrigin is WIRED, not merely available (H1)", () => {
  // The review found that `origin: "background"` had no production emitter at
  // all: the parameter, the compile-time parity guard and the pass-through test
  // all shipped while the call site did not — so D5/D12 did not exist in the
  // app, and `Ctrl+Tab` still jumped to files the AI had opened unseen.
  //
  // This reads source because no test drives the MCP handler end to end, and a
  // behavioural test of the mechanism is exactly what failed to catch this.
  // Note the consequence: `vitest --changed` cannot see this dependency, so it
  // is a `check:all` guard rather than an inner-loop one.
  it("labels the MCP background open", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/services/mcpBridge/v2/workspaceOpen.ts", "utf8");
    expect(src).toContain('withActivationOrigin("background"');
    // The label must cover the CREATE, which is what steals focus.
    const scope = src.slice(src.indexOf('withActivationOrigin("background"'));
    expect(scope.slice(0, 600)).toContain("createTab");
  });

  it("scopes announcements and restores the previous origin, even on throw", () => {
    const seen: string[] = [];
    const off = onTabActivated((_w, _t, origin) => seen.push(origin));

    withActivationOrigin("background", () => notifyTabActivated(WINDOW, "t1"));
    notifyTabActivated(WINDOW, "t2");
    expect(() =>
      withActivationOrigin("restore", () => {
        notifyTabActivated(WINDOW, "t3");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    notifyTabActivated(WINDOW, "t4");
    off();

    expect(seen).toEqual(["background", "user", "restore", "user"]);
  });
});
