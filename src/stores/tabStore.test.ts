import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "./tabStore";

function resetTabStore() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
}

beforeEach(resetTabStore);

describe("tabStore", () => {
  it("strips markdown extensions from tab titles", () => {
    const store = useTabStore.getState();

    store.createTab("main", "/docs/readme.md");
    store.createTab("main", "/docs/notes.markdown");
    store.createTab("main", "/docs/todo.txt");

    const tabs = store.getTabsByWindow("main");
    const titles = tabs.map((tab) => tab.title);

    expect(titles).toEqual(["readme", "notes", "todo"]);
  });
});
