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
import { useDocumentStore, useLargeFileSessionStore } from "@/stores/documentStore";
import { usePaneStore } from "@/stores/paneStore";
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

// #1554 — in a two-document split both panes render in the ONE window-scoped
// mode (split plan ADR-4), so moving focus between the panes is not a tab
// switch. Mirroring the newly focused document's own mode there flipped both
// panes, remounted both editors, and each remount's auto-focus moved the pane
// focus again — an endless Source/WYSIWYG ping-pong after F6.
describe("useTabModeSync inside a two-document split (#1554)", () => {
  let a: string;
  let b: string;

  beforeEach(() => {
    usePaneStore.setState({ byWindow: {} });
    useTabStore.getState().removeWindow("main");
    a = useTabStore.getState().createTab("main", "/a.md");
    b = useTabStore.getState().createTab("main", "/b.md");
    useDocumentStore.getState().initDocument(a, "", "/a.md");
    useDocumentStore.getState().initDocument(b, "", "/b.md");
    useLargeFileSessionStore.setState({ forcedSourceTabs: {} });
    useTabStore.getState().setActiveTab("main", a);
    usePaneStore.getState().openSplit("main", b); // focus lands on b
  });

  it("moving focus between the panes never flips the window mode", () => {
    const { unmount } = renderHook(() => useTabModeSync());
    // What F6 leaves behind: the window in Source, only the focused doc says so.
    useUIStore.setState({ sourceMode: true } as never);
    useDocumentStore.getState().setMode(b, "source");
    let flips = 0;
    const stop = useUIStore.subscribe((s, prev) => {
      if (s.sourceMode !== prev.sourceMode) flips += 1;
    });

    // The cycle's edge: each remounted pane taking focus in turn, repeatedly.
    for (let i = 0; i < 5; i += 1) {
      usePaneStore.getState().setFocusedPane("main", "primary");
      usePaneStore.getState().setFocusedPane("main", "secondary");
    }

    expect(flips).toBe(0);
    expect(useUIStore.getState().sourceMode).toBe(true);
    stop();
    unmount();
  });

  it("the document that gains pane focus adopts the mode it is displayed in", () => {
    const { unmount } = renderHook(() => useTabModeSync());
    useUIStore.setState({ sourceMode: true } as never);
    usePaneStore.getState().setFocusedPane("main", "primary");
    expect(useDocumentStore.getState().getDocument(a)?.mode).toBe("source");
    unmount();
  });

  it("a forced-source document keeps its own mode when it gains focus", () => {
    const { unmount } = renderHook(() => useTabModeSync());
    useLargeFileSessionStore.getState().markForcedSource(a);
    useDocumentStore.getState().setMode(a, "source");
    useUIStore.setState({ sourceMode: false } as never);
    usePaneStore.getState().setFocusedPane("main", "primary");
    expect(useDocumentStore.getState().getDocument(a)?.mode).toBe("source");
    expect(useUIStore.getState().sourceMode).toBe(false);
    unmount();
  });

  it("opening an unpaned document in a pane still mirrors its mode", () => {
    const c = useTabStore.getState().createTab("main", "/c.md");
    useDocumentStore.getState().initDocument(c, "", "/c.md");
    useDocumentStore.getState().setMode(c, "source");
    // createTab activated c; put focus back on b before the hook subscribes.
    useTabStore.getState().setActiveTab("main", b);
    useUIStore.setState({ sourceMode: false } as never);
    const { unmount } = renderHook(() => useTabModeSync());
    useTabStore.getState().setActiveTab("main", c);
    expect(usePaneStore.getState().getSplit("main").secondaryTabId).toBe(c);
    expect(useUIStore.getState().sourceMode).toBe(true);
    unmount();
  });

  it("collapsing the split onto the other document mirrors its mode again", () => {
    useDocumentStore.getState().setMode(a, "source");
    useUIStore.setState({ sourceMode: false } as never);
    const { unmount } = renderHook(() => useTabModeSync());
    usePaneStore.getState().closeSplit("main"); // primary a becomes active
    expect(useUIStore.getState().sourceMode).toBe(true);
    unmount();
  });
});
