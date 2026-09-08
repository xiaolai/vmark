// WI-FL3.3 — `tab.reopenClosed` reopens the newest closed tab of the window's
// active context through the REAL stores (no tab-store mock): close a tab, run
// the command, the tab is back and active. `reopenClosedTabForActiveContext`
// had recording and no trigger; this command is the trigger the menu item and
// the (unbound by default) shortcut both dispatch to.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { useTabStore, type Tab } from "@/stores/tabStore";
import { useClosedTabScopesStore } from "@/stores/tabStoreClosedScopes";
import { __resetRegistry } from "@/lib/formats/registry";
import { registerMarkdownFormat } from "@/lib/formats/adapters/markdown";
import { registerTabCommands } from "./tabCommands";
import { executeCommand, getCommand, _resetCommandBus } from "@/services/commands/CommandBus";

/** `Tab` is a union; only document tabs carry a path. */
const pathOf = (tab: Tab | null | undefined): string | null =>
  tab && "filePath" in tab ? tab.filePath : null;
const pathsIn = (windowLabel: string): (string | null)[] =>
  useTabStore.getState().getTabsByWindow(windowLabel).map(pathOf);

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useClosedTabScopesStore.getState().resetClosedScopes();
  __resetRegistry();
  registerMarkdownFormat();
  _resetCommandBus();
  registerTabCommands();
});

describe("tab.reopenClosed (WI-FL3.3)", () => {
  it("is registered with the other tab commands", () => {
    expect(getCommand("tab.reopenClosed")).toBeDefined();
  });

  it("reopens the most recently closed tab and activates it", async () => {
    const store = useTabStore.getState();
    const id1 = store.createTab("main", "/file1.md");
    store.createTab("main", "/file2.md");
    store.closeTab("main", id1);
    expect(pathsIn("main")).toEqual(["/file2.md"]);

    await executeCommand("tab.reopenClosed", null, { windowLabel: "main" });

    expect(pathsIn("main")).toContain("/file1.md");
    expect(pathOf(useTabStore.getState().getActiveTab("main"))).toBe("/file1.md");
  });

  it("reopens in LIFO order across repeated invocations", async () => {
    const store = useTabStore.getState();
    const id1 = store.createTab("main", "/file1.md");
    const id2 = store.createTab("main", "/file2.md");
    store.createTab("main", "/file3.md");
    store.closeTab("main", id1);
    store.closeTab("main", id2);

    await executeCommand("tab.reopenClosed", null, { windowLabel: "main" });
    expect(pathOf(useTabStore.getState().getActiveTab("main"))).toBe("/file2.md");
    await executeCommand("tab.reopenClosed", null, { windowLabel: "main" });
    expect(pathOf(useTabStore.getState().getActiveTab("main"))).toBe("/file1.md");
  });

  it("is a no-op when nothing has been closed", async () => {
    const store = useTabStore.getState();
    store.createTab("main", "/only.md");
    const before = useTabStore.getState().getTabsByWindow("main").map((t) => t.id);

    await executeCommand("tab.reopenClosed", null, { windowLabel: "main" });

    expect(useTabStore.getState().getTabsByWindow("main").map((t) => t.id)).toEqual(before);
  });

  it("scopes to the window it was dispatched for", async () => {
    const store = useTabStore.getState();
    const id1 = store.createTab("main", "/main.md");
    store.createTab("doc-2", "/other.md");
    store.closeTab("main", id1);

    await executeCommand("tab.reopenClosed", null, { windowLabel: "doc-2" });

    expect(useTabStore.getState().getTabsByWindow("main")).toHaveLength(0);
    expect(pathsIn("doc-2")).toEqual(["/other.md"]);
  });
});
