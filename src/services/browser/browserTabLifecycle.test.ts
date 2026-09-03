// @vitest-environment node
// Audit 2026-09-03 L-01 — browserTabLifecycle: a browser tab's native view and every
// per-tab record die with the tab, and only through the tab store.
import { describe, it, expect, beforeEach, vi } from "vitest";

const destroy = vi.fn<(tabId: string) => Promise<void>>(() => Promise.resolve());
vi.mock("./browserNativeViews", () => ({
  destroyBrowserNativeView: (tabId: string) => destroy(tabId),
  hasBrowserNativeView: () => false,
}));

import { useTabStore } from "@/stores/tabStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { closeBrowserTabById, startBrowserTabLifecycle } from "./browserTabLifecycle";

const WINDOW = "main";
let stop: () => void = () => {};

beforeEach(() => {
  useTabStore.getState().removeWindow(WINDOW);
  useTabStore.getState().removeWindow("second");
  useBrowserApprovalStore.setState({ pending: [], oneShots: [] });
  destroy.mockClear();
  stop();
  stop = startBrowserTabLifecycle();
});

describe("closeBrowserTabById", () => {
  it("closes a browser tab in whichever window holds it and destroys its native view", () => {
    const tabId = useTabStore.getState().createBrowserTab("second", "https://a.example/");

    expect(closeBrowserTabById(tabId)).toBe(true);

    expect(useTabStore.getState().tabs.second?.some((t) => t.id === tabId)).toBe(false);
    expect(destroy).toHaveBeenCalledWith(tabId);
  });

  it("returns false for an unknown id and for a document tab, and touches nothing", () => {
    const docId = useTabStore.getState().createTab(WINDOW, "/tmp/doc.md");

    expect(closeBrowserTabById("tab-nope")).toBe(false);
    expect(closeBrowserTabById(docId)).toBe(false);

    expect(useTabStore.getState().tabs[WINDOW]?.some((t) => t.id === docId)).toBe(true);
    expect(destroy).not.toHaveBeenCalled();
  });
});

describe("startBrowserTabLifecycle", () => {
  it("destroys the native view of a browser tab removed through the store", () => {
    const tabId = useTabStore.getState().createBrowserTab(WINDOW, "https://a.example/");
    useTabStore.getState().closeTab(WINDOW, tabId);
    expect(destroy).toHaveBeenCalledWith(tabId);
  });

  it("ignores a removed document tab", () => {
    const docId = useTabStore.getState().createTab(WINDOW, "/tmp/doc.md");
    useTabStore.getState().closeTab(WINDOW, docId);
    expect(destroy).not.toHaveBeenCalled();
  });
});
