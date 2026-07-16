import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserWorkspaceState, useBrowserWorkspaceActive } from "./useBrowserWorkspaceState";

const ctx = vi.hoisted(() => ({ isDocumentWindow: true, windowLabel: "main" }));
vi.mock("@/contexts/WindowContext", () => ({
  useIsDocumentWindow: () => ctx.isDocumentWindow,
  useWindowLabel: () => ctx.windowLabel,
}));

function resetStore() {
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    lastActiveBrowserPageId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
}

beforeEach(() => {
  ctx.isDocumentWindow = true;
  ctx.windowLabel = "main";
  resetStore();
});

describe("useBrowserWorkspaceState", () => {
  it("returns an empty projection in a non-document window", () => {
    ctx.isDocumentWindow = false;
    useTabStore.getState().createBrowserPage("main", "https://a.example/");
    const { result } = renderHook(() => useBrowserWorkspaceState());
    expect(result.current.browserWorkspace.browserPages).toHaveLength(0);
    expect(result.current.browserWorkspace.documentTabs).toHaveLength(0);
    expect(result.current.browserWorkspace.browserWorkspaceActive).toBe(false);
  });

  it("isolates by window label", () => {
    useTabStore.getState().createBrowserPage("other", "https://a.example/");
    const { result } = renderHook(() => useBrowserWorkspaceState());
    expect(result.current.browserWorkspace.browserPages).toHaveLength(0);
  });

  it("marks the workspace active when a browser page is the active tab", () => {
    const a = useTabStore.getState().createBrowserPage("main", "https://a.example/");
    const { result } = renderHook(() => useBrowserWorkspaceState());
    expect(result.current.browserWorkspace.browserWorkspaceActive).toBe(true);
    expect(result.current.browserWorkspace.activeBrowserPageId).toBe(a);
  });

  it("reopens to the LAST active page, not the first", () => {
    useTabStore.getState().createBrowserPage("main", "https://a.example/"); // A
    const b = useTabStore.getState().createBrowserPage("main", "https://b.example/"); // B active + last active
    const { result } = renderHook(() => useBrowserWorkspaceState());

    // Leave the browser workspace (no active tab) — simulates switching to a document.
    act(() => {
      useTabStore.getState().setActiveTab("main", null);
    });

    expect(result.current.browserWorkspace.activeBrowserPageId).toBeNull();
    expect(result.current.browserWorkspace.browserWorkspaceActive).toBe(false);
    expect(result.current.browserWorkspace.browserReturnPageId).toBe(b);
  });

  it("falls back to the first page when the remembered page was closed", () => {
    const a = useTabStore.getState().createBrowserPage("main", "https://a.example/");
    const b = useTabStore.getState().createBrowserPage("main", "https://b.example/"); // last active
    const { result } = renderHook(() => useBrowserWorkspaceState());

    act(() => {
      // Close B (the remembered page); leave the workspace.
      useTabStore.setState((s) => ({ tabs: { main: (s.tabs.main ?? []).filter((t) => t.id !== b) } }));
      useTabStore.getState().setActiveTab("main", null);
    });

    expect(result.current.browserWorkspace.browserReturnPageId).toBe(a);
  });

  it("exposes only { activeTabId, browserWorkspace } (no redundant aliases)", () => {
    const { result } = renderHook(() => useBrowserWorkspaceState());
    expect(Object.keys(result.current).sort()).toEqual(["activeTabId", "browserWorkspace"]);
  });
});

describe("useBrowserWorkspaceActive", () => {
  it("is false in a non-document window", () => {
    ctx.isDocumentWindow = false;
    useTabStore.getState().createBrowserPage("main", "https://a.example/");
    const { result } = renderHook(() => useBrowserWorkspaceActive());
    expect(result.current).toBe(false);
  });

  it("is true only while a browser page is the active tab, toggling on transitions", () => {
    useTabStore.getState().createBrowserPage("main", "https://a.example/");
    const { result } = renderHook(() => useBrowserWorkspaceActive());
    expect(result.current).toBe(true);

    // Switch to a document (no active browser page) → false.
    act(() => {
      useTabStore.getState().setActiveTab("main", null);
    });
    expect(result.current).toBe(false);
  });
});
