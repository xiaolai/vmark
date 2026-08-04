// WI-6 — the REAL live-webview bound: native surface lifecycle is active-page-only.
//
// Replaces the deleted browser-hibernation store's "live-webview cap" (plan WI-1.6, review
// finding E4). That store was never wired, and the unbounded-webview leak its LRU cap bounded
// was REFUTED: `BrowserWorkspaceSurface` mounts ONE `BrowserSurface` for the active page
// only, and `useBrowserNativeView` invokes `browser_destroy` on unmount — the live count is
// bounded at one per window, strictly tighter than the unwired cap of 3. These tests pin
// that mechanism, the property the deleted gate line pretended to certify.
//
// Decision ledger: .claude/tdd-guardian/decisions-20260803.md (D9 — E4 delete verdict).
//
// Mock boundary: `@tauri-apps/api/core` ONLY, as a STATEFUL fake — browser_create /
// browser_ai_create add to a live set, browser_destroy removes. Assertions are on the
// fake's state (how many native views exist), never on call choreography. Real tabStore,
// real browserUiStore, real BrowserSurface/useBrowserNativeView composition.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

/** The native side, as state: which webviews exist right now, and how many were ever made. */
const native = vi.hoisted(() => ({
  live: new Set<string>(),
  created: 0,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, unknown>) => {
    const tabId = typeof args?.tabId === "string" ? args.tabId : "";
    if (cmd === "browser_create" || cmd === "browser_ai_create") {
      native.live.add(tabId);
      native.created += 1;
    }
    if (cmd === "browser_destroy") native.live.delete(tabId);
    return Promise.resolve();
  }),
}));

vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));
vi.mock("@/contexts/PaneContext", () => ({ usePaneContext: () => null }));

import { BrowserWorkspaceSurface } from "./BrowserWorkspaceSurface";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserUiStore } from "@/stores/browserUiStore";

// jsdom has no ResizeObserver; the bounds hook needs one to exist.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

beforeEach(() => {
  native.live.clear();
  native.created = 0;
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    lastActiveBrowserPageId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
  useBrowserUiStore.setState({ entries: {} });
});

function openPage(url: string): string {
  let id = "";
  act(() => {
    id = useTabStore.getState().createBrowserPage("main", url);
  });
  return id;
}

describe("live-webview bound — active-page-only surface lifecycle", () => {
  it("opening N pages yields exactly ONE live native webview: the active page", async () => {
    const ids = Array.from({ length: 5 }, (_, i) => openPage(`https://p${i}.example/`));
    const { container } = render(<BrowserWorkspaceSurface />);

    await waitFor(() => expect(native.live.size).toBe(1));
    // The active page (the last created) owns the one view; inactive pages own none.
    expect(native.live.has(ids[4])).toBe(true);
    // Not even a transient create was issued for the 4 inactive pages.
    expect(native.created).toBe(1);
    expect(container.querySelectorAll(".browser-surface")).toHaveLength(1);
  });

  it("switching the active page swaps the single view — old destroyed, new created", async () => {
    const a = openPage("https://a.example/");
    const b = openPage("https://b.example/"); // b is active
    render(<BrowserWorkspaceSurface />);
    await waitFor(() => expect(native.live.has(b)).toBe(true));

    act(() => {
      useTabStore.getState().setActiveTab("main", a);
    });

    await waitFor(() => {
      expect(native.live.has(a)).toBe(true);
      expect(native.live.has(b)).toBe(false);
    });
    expect(native.live.size).toBe(1);
  });

  it("closing the active page releases its native webview (count decrements)", async () => {
    openPage("https://a.example/");
    const b = openPage("https://b.example/"); // b is active
    const { unmount } = render(<BrowserWorkspaceSurface />);
    await waitFor(() => expect(native.live.has(b)).toBe(true));

    act(() => {
      useTabStore.getState().closeTab("main", b);
    });

    // b's view is torn down; whatever the store activates next, the bound holds.
    await waitFor(() => {
      expect(native.live.has(b)).toBe(false);
      expect(native.live.size).toBeLessThanOrEqual(1);
    });

    // Unmounting the workspace releases the last view — nothing survives the surface.
    unmount();
    await waitFor(() => expect(native.live.size).toBe(0));
  });

  it("rapid open/close ×10 returns to baseline — no monotonic growth", async () => {
    render(<BrowserWorkspaceSurface />);

    for (let i = 0; i < 10; i++) {
      const id = openPage(`https://rapid${i}.example/`);
      // Close immediately — no settling between: the create may still be in
      // flight when the surface unmounts (the deferred-destroy race, hazard 1).
      act(() => {
        useTabStore.getState().closeTab("main", id);
      });
    }

    await waitFor(() => expect(native.live.size).toBe(0));
  });

  it("rapid remount ×10 of the same page converges to one view, then zero on unmount", async () => {
    const id = openPage("https://sticky.example/");
    for (let i = 0; i < 10; i++) {
      const { unmount } = render(<BrowserWorkspaceSurface />);
      unmount();
    }
    const { unmount } = render(<BrowserWorkspaceSurface />);

    await waitFor(() => {
      expect(native.live.size).toBe(1);
      expect(native.live.has(id)).toBe(true);
    });

    unmount();
    await waitFor(() => expect(native.live.size).toBe(0));
  });
});
