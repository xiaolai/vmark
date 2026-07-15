// WI-S2.1 / WI-S2.3 — the sidebar follows the active tab's KIND (ADR-2).
//
// WI-S2.4 — and NO hot-exit migration is required, which these tests are what makes safe.
// The plan assumed two remembered sub-views meant bumping the persisted schema. They do
// not, because the browser sub-view is SESSION-ONLY — the coherent choice, since the
// browser's history and its site permissions both lapse when VMark quits, so remembering
// which of them you were looking at would outlive the thing it pointed at. The persisted
// field (`sidebar_view_mode`, a bare string in a v5 snapshot) therefore keeps its exact
// v5 contract, and the test below is the thing that keeps it that way: if a browser value
// could ever reach it, a v5 snapshot would carry a value it has no idea how to read.
//
// The sidebar tracks what you are looking at rather than making you manage a second
// mode by hand. Switching between a document and a browser must not clobber the other
// kind's remembered sub-view.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
  useIsDocumentWindow: () => true,
}));

import { useSidebarContext } from "./useSidebarContext";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";

function activate(kind: "document" | "browser") {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  const id =
    kind === "browser"
      ? useTabStore.getState().createBrowserTab("main", "https://a.com/", "A")
      : useTabStore.getState().createTab("main", null);
  useTabStore.getState().setActiveTab("main", id);
}

beforeEach(() => {
  useUIStore.setState({ sidebarViewMode: "outline", sidebarBrowserViewMode: "browser-history" });
});

describe("useSidebarContext", () => {
  it("shows document views for a document tab", () => {
    activate("document");
    const { result } = renderHook(() => useSidebarContext());
    expect(result.current.kind).toBe("document");
    expect(result.current.view).toBe("outline");
  });

  it("shows browser views for a browser tab, with no manual switch", () => {
    activate("browser");
    const { result } = renderHook(() => useSidebarContext());
    expect(result.current.kind).toBe("browser");
    expect(result.current.view).toBe("browser-history");
  });

  it("setView writes to the store belonging to the ACTIVE kind", () => {
    activate("browser");
    const { result } = renderHook(() => useSidebarContext());
    act(() => result.current.setView("bookmarks"));

    expect(useUIStore.getState().sidebarBrowserViewMode).toBe("bookmarks");
    // The document sub-view is untouched.
    expect(useUIStore.getState().sidebarViewMode).toBe("outline");
  });

  // WI-S2.4 — this is the assertion that means no hot-exit migration is needed. A browser
  // value reaching the persisted `sidebar_view_mode` would put a string into a v5 snapshot
  // that v5 has no idea how to read.
  it("a browser sub-view NEVER lands in the persisted document field", () => {
    activate("browser");
    const { result } = renderHook(() => useSidebarContext());
    act(() => result.current.setView("bookmarks"));
    act(() => result.current.setView("browser-history"));

    const persisted = useUIStore.getState().sidebarViewMode;
    expect(["files", "outline", "history"]).toContain(persisted);
  });

  // WI-S2.3 — the whole point of two remembered modes.
  it("switching tab kind restores each kind's own remembered sub-view", () => {
    activate("document");
    const doc = renderHook(() => useSidebarContext());
    act(() => doc.result.current.setView("files"));
    expect(doc.result.current.view).toBe("files");

    activate("browser");
    const browser = renderHook(() => useSidebarContext());
    act(() => browser.result.current.setView("bookmarks"));
    expect(browser.result.current.view).toBe("bookmarks");

    // Back to the document: its sub-view survived the excursion.
    activate("document");
    const back = renderHook(() => useSidebarContext());
    expect(back.result.current.view).toBe("files");
  });

  it("falls back to document views when there is no active tab", () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
    const { result } = renderHook(() => useSidebarContext());
    expect(result.current.kind).toBe("document");
  });
});
