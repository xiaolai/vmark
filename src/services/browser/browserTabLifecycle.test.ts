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
// The confirming `browser_destroy` (round 3, #44) — the one driver call this module makes.
const invoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: Parameters<typeof invoke>) => invoke(...a) }));

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
  destroy.mockClear().mockImplementation(() => Promise.resolve());
  hasNative.mockReset().mockReturnValue(false);
  invoke.mockReset().mockImplementation(() => Promise.resolve());
  stop();
  stop = startBrowserTabLifecycle();
});

describe("closeBrowserTabById", () => {
  it("closes a browser tab in whichever window holds it, awaits its teardown and confirms it with the driver", async () => {
    const tabId = useTabStore.getState().createBrowserTab("second", "https://a.example/");
    let teardownSettled = false;
    destroy.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(() => { teardownSettled = true; resolve(); }, 5)),
    );
    invoke.mockImplementation(async () => {
      // The confirmation must not race the teardown it confirms.
      expect(teardownSettled).toBe(true);
    });

    await expect(closeBrowserTabById(tabId)).resolves.toEqual({ destroyed: true });

    expect(useTabStore.getState().tabs.second?.some((t) => t.id === tabId)).toBe(false);
    expect(destroy).toHaveBeenCalledWith(tabId);
    expect(invoke).toHaveBeenCalledWith("browser_destroy", { tabId });
  });

  // Round 3, #44 — the shared teardown reports a native failure with a warning and
  // resolves anyway; the confirming destroy is the one observable of that failure.
  it("reports destroyed:false with the driver's reason when the confirming destroy is refused", async () => {
    const tabId = useTabStore.getState().createBrowserTab(WINDOW, "https://a.example/");
    invoke.mockRejectedValue({ code: "internal", message: "surface: main thread unavailable" });

    await expect(closeBrowserTabById(tabId)).resolves.toEqual({
      destroyed: false,
      reason: "surface: main thread unavailable",
    });
    // The record is gone either way — the tab left the store before the teardown ran.
    expect(useTabStore.getState().findTabById(tabId)).toBeNull();
  });

  it("resolves null for an unknown id and for a document tab, and touches nothing", async () => {
    const docId = useTabStore.getState().createTab(WINDOW, "/tmp/doc.md");

    await expect(closeBrowserTabById("tab-nope")).resolves.toBeNull();
    await expect(closeBrowserTabById(docId)).resolves.toBeNull();

    expect(useTabStore.getState().tabs[WINDOW]?.some((t) => t.id === docId)).toBe(true);
    expect(destroy).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("resolves null for a pinned tab the store refuses, without touching the driver", async () => {
    const tabId = useTabStore.getState().createBrowserTab(WINDOW, "https://p.example/");
    useTabStore.getState().togglePin(WINDOW, tabId);

    await expect(closeBrowserTabById(tabId)).resolves.toBeNull();

    expect(useTabStore.getState().findTabById(tabId)).not.toBeNull();
    expect(destroy).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
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
