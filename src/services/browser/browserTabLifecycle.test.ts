// @vitest-environment node
// Audit 2026-09-03 L-01 — browserTabLifecycle: a browser tab's native view and every
// per-tab record die with the tab, and only through the tab store.
import { describe, it, expect, beforeEach, vi } from "vitest";

const destroy = vi.fn<(tabId: string) => Promise<void>>(() => Promise.resolve());
const hasNative = vi.fn<(tabId: string) => boolean>(() => false);
vi.mock("./browserNativeViews", () => ({
  destroyBrowserNativeView: (tabId: string) => destroy(tabId),
  hasBrowserNativeView: (tabId: string) => hasNative(tabId),
}));

import { useTabStore } from "@/stores/tabStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { approvalDenied, closeBrowserTabById, startBrowserTabLifecycle } from "./browserTabLifecycle";
import type { PendingApproval } from "@/stores/browserApprovalStore.types";

const WINDOW = "main";
let stop: () => void = () => {};

beforeEach(() => {
  useTabStore.getState().removeWindow(WINDOW);
  useTabStore.getState().removeWindow("second");
  useBrowserApprovalStore.setState({ pending: [], oneShots: [] });
  destroy.mockClear();
  hasNative.mockReset().mockReturnValue(false);
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


// The denial cleanup path had no test past the missing-tab return (audit 2026-09-03,
// round 1). Table over every branch: the request is always resolved as denied, and
// ONLY a never-loaded AI tab awaiting its destination approval is closed.
describe("approvalDenied", () => {
  function request(overrides: Partial<PendingApproval> & { tabId: string }): PendingApproval {
    return { id: "req-1", targetUrl: "https://a.example/", operation: "navigate", generation: 0, ...overrides };
  }
  function pending(req: PendingApproval): void {
    useBrowserApprovalStore.setState((s) => ({ pending: [...s.pending, req] }));
  }
  function tabExists(tabId: string): boolean {
    return useTabStore.getState().findTabById(tabId) !== null && useTabStore.getState().findTabById(tabId) !== undefined;
  }

  it("closes a never-loaded AI tab whose destination approval was denied", () => {
    const tabId = useTabStore.getState().createBrowserTab(WINDOW, "https://a.example/", undefined, "ai-shared");
    const req = request({ tabId });
    pending(req);
    approvalDenied(req);
    expect(useBrowserApprovalStore.getState().pending).toEqual([]);
    expect(tabExists(tabId)).toBe(false);
    expect(destroy).toHaveBeenCalledWith(tabId);
  });

  it.each([
    ["a human tab", () => useTabStore.getState().createBrowserTab(WINDOW, "https://h.example/"), {}],
    [
      "an AI tab that has already loaded a page (generation known)",
      () => {
        const id = useTabStore.getState().createBrowserTab(WINDOW, "https://l.example/", undefined, "ai-shared");
        useTabStore.getState().updateBrowserTab(id, { url: "https://l.example/", generation: 2 });
        return id;
      },
      {},
    ],
    [
      "an AI tab whose native view exists",
      () => {
        hasNative.mockReturnValue(true);
        return useTabStore.getState().createBrowserTab(WINDOW, "https://n.example/", undefined, "ai-sandbox");
      },
      {},
    ],
    [
      "a non-navigation approval on a never-loaded AI tab",
      () => useTabStore.getState().createBrowserTab(WINDOW, "https://c.example/", undefined, "ai-shared"),
      { operation: "click" as const },
    ],
  ])("leaves %s open and only resolves the denial", (_label, seed, overrides) => {
    const tabId = seed();
    const req = request({ tabId, ...overrides });
    pending(req);
    approvalDenied(req);
    expect(useBrowserApprovalStore.getState().pending).toEqual([]);
    expect(tabExists(tabId)).toBe(true);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("tolerates a request whose tab is already gone", () => {
    const req = request({ tabId: "tab-gone" });
    pending(req);
    expect(() => approvalDenied(req)).not.toThrow();
    expect(useBrowserApprovalStore.getState().pending).toEqual([]);
  });
});
