/**
 * `updateTabTitle` and store identity.
 *
 * It re-implemented the keyed-update scan that `mapDocumentTabById` already
 * owned, and did it less carefully: every call cloned the whole `tabs` map and
 * every window's array, even when the title was already what was asked for.
 * A no-op setter that hands back fresh references wakes every `state.tabs`
 * subscriber and re-renders the tab strip for nothing — and hot-exit restore
 * calls this on every tab at startup.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "./tabStore";

const WINDOW = "main";

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
});

describe("updateTabTitle", () => {
  it("renames the target tab", () => {
    const id = useTabStore.getState().createTab(WINDOW, null);
    useTabStore.getState().updateTabTitle(id, "Renamed");
    expect(useTabStore.getState().findTabById(id)?.title).toBe("Renamed");
  });

  it("keeps the whole map's identity when the title is unchanged", () => {
    const id = useTabStore.getState().createTab(WINDOW, "/a.md");
    const before = useTabStore.getState().tabs;

    useTabStore.getState().updateTabTitle(id, "a.md");

    expect(useTabStore.getState().tabs).toBe(before);
  });

  it("keeps the map's identity for an unknown id", () => {
    useTabStore.getState().createTab(WINDOW, "/a.md");
    const before = useTabStore.getState().tabs;

    useTabStore.getState().updateTabTitle("no-such-tab", "X");

    expect(useTabStore.getState().tabs).toBe(before);
  });

  it("leaves untouched windows' arrays alone", () => {
    const id = useTabStore.getState().createTab(WINDOW, "/a.md");
    useTabStore.getState().createTab("second", "/b.md");
    const before = useTabStore.getState().tabs;

    useTabStore.getState().updateTabTitle(id, "Renamed");

    const after = useTabStore.getState().tabs;
    expect(after.second).toBe(before.second);
    expect(after.main).not.toBe(before.main);
  });

  it("still renames a browser tab — the strip shows page titles too", () => {
    const id = useTabStore.getState().createBrowserTab(WINDOW, "https://x.dev/", "x");
    useTabStore.getState().updateTabTitle(id, "X — home");
    expect(useTabStore.getState().findTabById(id)?.title).toBe("X — home");
  });
});
