// useTabModeSync (ADR-009) — switching the active tab mirrors the new
// document's per-doc mode into the window's uiStore.sourceMode. Only
// genuine active-tab changes trigger the mirror; unknown docs and
// same-tab updates are no-ops, and the subscription dies on unmount.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { useTabModeSync } from "./useTabModeSync";

function activate(tabId: string | undefined) {
  useTabStore.setState({ activeTabId: { main: tabId as string } });
}

beforeEach(() => {
  useTabStore.setState({
    tabs: {
      main: [
        { id: "wys", filePath: null, title: "w", isPinned: false },
        { id: "src", filePath: null, title: "s", isPinned: false },
      ],
    },
    activeTabId: { main: "wys" },
    untitledCounter: 0,
    closedTabs: {},
  });
  useDocumentStore.setState({ documents: {} });
  useDocumentStore.getState().initDocument("wys", "", null);
  useDocumentStore.getState().initDocument("src", "", null);
  useDocumentStore.getState().setMode("src", "source");
  useUIStore.setState({ sourceMode: false } as never);
});

describe("useTabModeSync", () => {
  it("switching to a source-mode tab flips the window into Source mode", () => {
    const { unmount } = renderHook(() => useTabModeSync());
    activate("src");
    expect(useUIStore.getState().sourceMode).toBe(true);
    unmount();
  });

  it("switching back to a WYSIWYG tab flips the window out of Source mode", () => {
    useUIStore.setState({ sourceMode: true } as never);
    useTabStore.setState({ activeTabId: { main: "src" } });
    const { unmount } = renderHook(() => useTabModeSync());
    activate("wys");
    expect(useUIStore.getState().sourceMode).toBe(false);
    unmount();
  });

  it("re-setting the same active tab is a no-op (manual mode toggle survives)", () => {
    const { unmount } = renderHook(() => useTabModeSync());
    // User manually toggled Source mode on the WYSIWYG tab.
    useUIStore.setState({ sourceMode: true } as never);
    activate("wys"); // same tab — subscriber must early-return
    expect(useUIStore.getState().sourceMode).toBe(true);
    unmount();
  });

  it("ignores a switch to a tab with no backing document", () => {
    useUIStore.setState({ sourceMode: true } as never);
    const { unmount } = renderHook(() => useTabModeSync());
    activate("ghost");
    expect(useUIStore.getState().sourceMode).toBe(true);
    unmount();
  });

  it("ignores clearing the active tab (undefined next id)", () => {
    const { unmount } = renderHook(() => useTabModeSync());
    useUIStore.setState({ sourceMode: true } as never);
    activate(undefined);
    expect(useUIStore.getState().sourceMode).toBe(true);
    unmount();
  });

  it("stops mirroring after unmount (subscription cleaned up)", () => {
    const { unmount } = renderHook(() => useTabModeSync());
    unmount();
    activate("src");
    expect(useUIStore.getState().sourceMode).toBe(false);
  });
});
