// WI-6 — the REAL live-webview bound: one native view per OPEN browser tab, no more.
//
// D9 (decisions-20260803) pinned "one per window": the surface mounted for the active
// page only and destroyed its view on unmount. The 2026-09-03 audit (L-01) showed the
// cost: a glance at a document reloaded the page, lost its state, and made the driver
// forget the tab — its restarted generation then collided with the frontend's
// monotonic guard and every AI operation on the tab was refused as stale. A web page
// is a document with state, so views now stay alive while their TAB exists (hidden
// under the background occluder when not on screen) and are destroyed when the tab
// is closed — the bound every browser has. Memory is bounded by the tab count, and the
// AI side is capped at MAX_AI_TABS in the driver. D9 is amended in the ledger.
//
// These tests pin the new invariants: live views ≤ open browser tabs; a view is created
// once per tab and never recreated on switch; a closed tab releases its view (through
// the removal bus → browserTabLifecycle); rapid open/close returns to baseline.
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
import { __resetNativeViews } from "./useBrowserNativeView";
import { startBrowserTabLifecycle } from "@/services/browser/browserTabLifecycle";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserUiStore } from "@/stores/browserUiStore";

let stopLifecycle: (() => void) | null = null;

// jsdom has no ResizeObserver; the bounds hook needs one to exist.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

beforeEach(() => {
  stopLifecycle?.();
  native.live.clear();
  native.created = 0;
  __resetNativeViews();
  stopLifecycle = startBrowserTabLifecycle();
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

describe("live-webview bound — one view per open browser tab", () => {
  it("opening N pages creates a view only for the page that was shown", async () => {
    const ids = Array.from({ length: 5 }, (_, i) => openPage(`https://p${i}.example/`));
    const { container } = render(<BrowserWorkspaceSurface />);

    await waitFor(() => expect(native.live.size).toBe(1));
    // The active page (the last created) owns the one view; pages never shown own none.
    expect(native.live.has(ids[4])).toBe(true);
    expect(native.created).toBe(1);
    expect(container.querySelectorAll(".browser-surface")).toHaveLength(1);
  });

  it("switching the active page keeps the old view alive and creates the new one — never more than open tabs", async () => {
    const a = openPage("https://a.example/");
    const b = openPage("https://b.example/"); // b is active
    render(<BrowserWorkspaceSurface />);
    await waitFor(() => expect(native.live.has(b)).toBe(true));

    act(() => {
      useTabStore.getState().setActiveTab("main", a);
    });
    await waitFor(() => expect(native.live.has(a)).toBe(true));
    // b left the screen but not the world: its page (and driver state) survive.
    expect(native.live.has(b)).toBe(true);
    expect(native.live.size).toBe(2);
    expect(native.live.size).toBeLessThanOrEqual(useTabStore.getState().tabs.main!.length);

    // Switching back creates nothing: the view was there the whole time.
    act(() => {
      useTabStore.getState().setActiveTab("main", b);
    });
    await Promise.resolve();
    expect(native.created).toBe(2);
  });

  it("closing a page releases its native webview (count decrements), shown or not", async () => {
    const a = openPage("https://a.example/");
    const b = openPage("https://b.example/"); // b is active
    render(<BrowserWorkspaceSurface />);
    await waitFor(() => expect(native.live.has(b)).toBe(true));
    act(() => {
      useTabStore.getState().setActiveTab("main", a);
    });
    await waitFor(() => expect(native.live.has(a)).toBe(true));

    // Close the BACKGROUND page: its hidden view must go too.
    act(() => {
      useTabStore.getState().closeTab("main", b);
    });
    await waitFor(() => expect(native.live.has(b)).toBe(false));
    expect(native.live.has(a)).toBe(true);

    act(() => {
      useTabStore.getState().closeTab("main", a);
    });
    await waitFor(() => expect(native.live.size).toBe(0));
  });

  it("unmounting the workspace surface hides views but does not destroy them — tabs own views", async () => {
    const id = openPage("https://sticky.example/");
    const { unmount } = render(<BrowserWorkspaceSurface />);
    await waitFor(() => expect(native.live.has(id)).toBe(true));
    unmount();
    await Promise.resolve();
    expect(native.live.has(id)).toBe(true);
    // Closing the tab is what releases it.
    act(() => {
      useTabStore.getState().closeTab("main", id);
    });
    await waitFor(() => expect(native.live.size).toBe(0));
  });

  it("rapid open/close ×10 returns to baseline — no monotonic growth", async () => {
    render(<BrowserWorkspaceSurface />);

    for (let i = 0; i < 10; i++) {
      const id = openPage(`https://rapid${i}.example/`);
      // Close immediately — no settling between: the create may still be in
      // flight when the tab closes (destroy waits for it, then tears down).
      act(() => {
        useTabStore.getState().closeTab("main", id);
      });
    }

    await waitFor(() => expect(native.live.size).toBe(0));
  });

  it("rapid remount ×10 of the same page converges to one view, created once", async () => {
    const id = openPage("https://sticky.example/");
    for (let i = 0; i < 10; i++) {
      const { unmount } = render(<BrowserWorkspaceSurface />);
      unmount();
    }
    render(<BrowserWorkspaceSurface />);

    await waitFor(() => {
      expect(native.live.size).toBe(1);
      expect(native.live.has(id)).toBe(true);
    });
    expect(native.created).toBe(1);
  });
});
