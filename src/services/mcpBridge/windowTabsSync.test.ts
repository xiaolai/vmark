// @vitest-environment node
// Each window publishes the ids of the tabs it holds to the bridge, so a
// request naming a tab routes to the window that can answer it: on start, on
// every change of its own tab list (and only then), and empty on teardown.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "doc-1" }));

import { useTabStore } from "@/stores/tabStore";
import { startWindowTabsSync } from "./windowTabsSync";

const tab = (id: string) => ({ kind: "document" as const, id, filePath: null, title: id, isPinned: false, formatId: "markdown" });

beforeEach(() => {
  useTabStore.setState({ tabs: { "doc-1": [tab("t-a")], other: [tab("t-x")] }, activeTabId: {}, untitledCounter: 0 });
});

describe("startWindowTabsSync", () => {
  it("publishes this window's tabs on start, and only this window's", () => {
    const invoke = vi.fn(() => Promise.resolve());
    const stop = startWindowTabsSync(invoke as never);
    expect(invoke).toHaveBeenCalledWith("mcp_bridge_set_window_tabs", { tabIds: ["t-a"] });
    stop();
  });

  it("republishes when its tab list changes, not when another window's or nothing does", () => {
    const invoke = vi.fn(() => Promise.resolve());
    const stop = startWindowTabsSync(invoke as never);
    invoke.mockClear();

    useTabStore.setState((s) => ({ tabs: { ...s.tabs, other: [tab("t-x"), tab("t-y")] } }));
    useTabStore.setState((s) => ({ activeTabId: { ...s.activeTabId, "doc-1": "t-a" } }));
    expect(invoke).not.toHaveBeenCalled();

    useTabStore.setState((s) => ({ tabs: { ...s.tabs, "doc-1": [tab("t-a"), tab("t-b")] } }));
    expect(invoke).toHaveBeenCalledWith("mcp_bridge_set_window_tabs", { tabIds: ["t-a", "t-b"] });
    stop();
  });

  it("publishes an empty list on teardown and stops listening", () => {
    const invoke = vi.fn(() => Promise.resolve());
    const stop = startWindowTabsSync(invoke as never);
    stop();
    expect(invoke).toHaveBeenLastCalledWith("mcp_bridge_set_window_tabs", { tabIds: [] });
    invoke.mockClear();
    useTabStore.setState((s) => ({ tabs: { ...s.tabs, "doc-1": [tab("t-z")] } }));
    expect(invoke).not.toHaveBeenCalled();
  });
});
