// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { browserTabIsActive, getBrowserWorkspaceActive } from "./browserWorkspaceActive";
import { useTabStore } from "@/stores/tabStore";

const initialTabs = useTabStore.getState().tabs;
const initialActiveTabId = useTabStore.getState().activeTabId;

afterEach(() => {
  useTabStore.setState({ tabs: initialTabs, activeTabId: initialActiveTabId } as never);
});

describe("browserTabIsActive", () => {
  const tabs = [
    { id: "d1", kind: "document" },
    { id: "b1", kind: "browser" },
  ];

  it("is true when the active tab is a browser tab", () => {
    expect(browserTabIsActive(tabs, "b1")).toBe(true);
  });

  it("is false when the active tab is a document", () => {
    expect(browserTabIsActive(tabs, "d1")).toBe(false);
  });

  it("is false when nothing is active", () => {
    expect(browserTabIsActive(tabs, null)).toBe(false);
    expect(browserTabIsActive(tabs, undefined)).toBe(false);
    expect(browserTabIsActive(tabs, "")).toBe(false);
  });

  // A stale active id outliving its tab is the shape that would otherwise throw
  // or report true on an empty list.
  it("is false when the active id names no existing tab", () => {
    expect(browserTabIsActive(tabs, "gone")).toBe(false);
    expect(browserTabIsActive([], "b1")).toBe(false);
  });

  it("does not treat a tab with no kind as a browser", () => {
    expect(browserTabIsActive([{ id: "x" }], "x")).toBe(false);
  });
});

describe("getBrowserWorkspaceActive", () => {
  it("reads the store for the given window", () => {
    useTabStore.setState({
      tabs: { main: [{ id: "b1", kind: "browser" }], other: [{ id: "d1", kind: "document" }] },
      activeTabId: { main: "b1", other: "d1" },
    } as never);

    expect(getBrowserWorkspaceActive("main")).toBe(true);
    expect(getBrowserWorkspaceActive("other")).toBe(false);
  });

  it("is false for a window with no tabs recorded", () => {
    useTabStore.setState({ tabs: {}, activeTabId: {} } as never);
    expect(getBrowserWorkspaceActive("nope")).toBe(false);
  });
});
