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

  it("swaps the focused (secondary) pane's tab + the activeTabId alias", () => {
    usePaneStore.getState().openSplit(W, "tab-2"); // focuses secondary
    activateTabInFocusedPane(W, "tab-x");
    expect(usePaneStore.getState().getSplit(W).secondaryTabId).toBe("tab-x");
    expect(usePaneStore.getState().getSplit(W).primaryTabId).toBe("primary-tab"); // untouched
    expect(useTabStore.getState().activeTabId[W]).toBe("tab-x"); // alias follows focus
  });

  it("swaps the focused (primary) pane's tab when the primary is focused in a split", () => {
    usePaneStore.getState().openSplit(W, "tab-2");
    usePaneStore.getState().setFocusedPane(W, "primary");
    activateTabInFocusedPane(W, "tab-x");
    expect(usePaneStore.getState().getSplit(W).primaryTabId).toBe("tab-x");
    expect(usePaneStore.getState().getSplit(W).secondaryTabId).toBe("tab-2"); // untouched
    expect(useTabStore.getState().activeTabId[W]).toBe("tab-x");
  });
});
