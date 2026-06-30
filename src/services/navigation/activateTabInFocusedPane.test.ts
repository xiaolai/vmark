import { describe, it, expect, beforeEach } from "vitest";
import { activateTabInFocusedPane } from "./activateTabInFocusedPane";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";

const W = "main";

beforeEach(() => {
  usePaneStore.setState({ byWindow: {} });
  useTabStore.setState({ activeTabId: { [W]: "primary-tab" } } as never);
});

describe("activateTabInFocusedPane (#1081)", () => {
  it("sets the primary active tab when no split is open", () => {
    activateTabInFocusedPane(W, "tab-x");
    expect(useTabStore.getState().activeTabId[W]).toBe("tab-x");
  });

  it("swaps the secondary pane's tab (not the primary) when the secondary is focused", () => {
    usePaneStore.getState().openSplit(W, "tab-2"); // focuses secondary
    activateTabInFocusedPane(W, "tab-x");
    expect(usePaneStore.getState().getSplit(W).secondaryTabId).toBe("tab-x");
    expect(useTabStore.getState().activeTabId[W]).toBe("primary-tab");
  });

  it("sets the primary active tab when the primary pane is focused in a split", () => {
    usePaneStore.getState().openSplit(W, "tab-2");
    usePaneStore.getState().setFocusedPane(W, "primary");
    activateTabInFocusedPane(W, "tab-x");
    expect(useTabStore.getState().activeTabId[W]).toBe("tab-x");
    expect(usePaneStore.getState().getSplit(W).secondaryTabId).toBe("tab-2");
  });
});
