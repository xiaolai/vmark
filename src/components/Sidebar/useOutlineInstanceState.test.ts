// WI-9.3 — outline state per (workspace instance, tab): collapsed keys,
// filter query, and scroll offset persist across rail switches; local-state
// fallback when the rail is off. Stale heading keys are pruned; tab close
// removes the tab's outline state everywhere.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useWorkspaceInstanceUiStore } from "@/stores/workspaceInstanceUiStore";
import { notifyTabRemoved } from "@/stores/tabRemovalBus";
import { useOutlineInstanceState } from "./useOutlineInstanceState";

beforeEach(() => {
  useWorkspaceInstanceUiStore.getState().resetInstanceUiStates();
});

describe("useOutlineInstanceState (persisted: rail on)", () => {
  it("persists filter and collapsed keys per (instance, tab) across remounts", () => {
    const first = renderHook(() => useOutlineInstanceState("wsi-a", "tab-1"));
    act(() => {
      first.result.current.setFilterQuery("setup");
      first.result.current.toggleCollapsedKey("2:10:Install");
    });
    first.unmount();

    const second = renderHook(() => useOutlineInstanceState("wsi-a", "tab-1"));
    expect(second.result.current.filterQuery).toBe("setup");
    expect(second.result.current.collapsedKeys.has("2:10:Install")).toBe(true);
  });

  it("keeps state independent across instances and tabs", () => {
    const a1 = renderHook(() => useOutlineInstanceState("wsi-a", "tab-1"));
    act(() => a1.result.current.toggleCollapsedKey("1:1:Intro"));

    const b1 = renderHook(() => useOutlineInstanceState("wsi-b", "tab-1"));
    const a2 = renderHook(() => useOutlineInstanceState("wsi-a", "tab-2"));

    expect(b1.result.current.collapsedKeys.size).toBe(0);
    expect(a2.result.current.collapsedKeys.size).toBe(0);
    expect(a1.result.current.collapsedKeys.has("1:1:Intro")).toBe(true);
  });

  it("toggle removes an existing key (collapse → expand)", () => {
    const { result } = renderHook(() => useOutlineInstanceState("wsi-a", "tab-1"));
    act(() => result.current.toggleCollapsedKey("1:1:Intro"));
    act(() => result.current.toggleCollapsedKey("1:1:Intro"));
    expect(result.current.collapsedKeys.size).toBe(0);
  });

  it("supports Unicode/CJK heading keys", () => {
    const { result } = renderHook(() => useOutlineInstanceState("wsi-a", "tab-1"));
    act(() => result.current.toggleCollapsedKey("2:5:安装指南 — Émigré"));
    expect(result.current.collapsedKeys.has("2:5:安装指南 — Émigré")).toBe(true);
  });

  it("prunes keys no longer present in the document (edited heading text)", () => {
    const { result } = renderHook(() => useOutlineInstanceState("wsi-a", "tab-1"));
    act(() => {
      result.current.toggleCollapsedKey("2:10:Old Title");
      result.current.toggleCollapsedKey("2:20:Kept");
    });

    act(() => result.current.pruneCollapsedKeys(new Set(["2:20:Kept", "2:30:New"])));

    expect(result.current.collapsedKeys.has("2:10:Old Title")).toBe(false);
    expect(result.current.collapsedKeys.has("2:20:Kept")).toBe(true);
  });

  it("prune with identical keys is a no-op write (duplicate headings stay)", () => {
    const { result } = renderHook(() => useOutlineInstanceState("wsi-a", "tab-1"));
    act(() => result.current.toggleCollapsedKey("2:10:Same"));
    act(() => result.current.pruneCollapsedKeys(new Set(["2:10:Same", "2:12:Same"])));
    expect(result.current.collapsedKeys.has("2:10:Same")).toBe(true);
  });

  it("captures throttled scroll and restores it onto an element", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useOutlineInstanceState("wsi-a", "tab-1"));
      act(() => {
        result.current.handleScroll(30);
        result.current.handleScroll(90);
        vi.runAllTimers();
      });
      expect(
        useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a")
          .outlineByTabId["tab-1"]?.scrollOffset,
      ).toBe(90);

      const el = document.createElement("div");
      act(() => result.current.restoreScrollTo(el));
      expect(el.scrollTop).toBe(90);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes the tab's outline state everywhere when the tab closes", () => {
    const a = renderHook(() => useOutlineInstanceState("wsi-a", "tab-1"));
    act(() => a.result.current.toggleCollapsedKey("1:1:Intro"));

    act(() => notifyTabRemoved("main", "tab-1"));

    expect(
      useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a")
        .outlineByTabId["tab-1"],
    ).toBeUndefined();
  });
});

describe("useOutlineInstanceState (local fallback: rail off)", () => {
  it("works with null ids and never touches the instance store", () => {
    const { result } = renderHook(() => useOutlineInstanceState(null, null));
    act(() => {
      result.current.setFilterQuery("q");
      result.current.toggleCollapsedKey("1:1:Intro");
      result.current.handleScroll(10);
    });

    expect(result.current.filterQuery).toBe("q");
    expect(result.current.collapsedKeys.has("1:1:Intro")).toBe(true);
    expect(useWorkspaceInstanceUiStore.getState().instanceUiStates).toEqual({});
  });

  it("restoreScrollTo is a safe no-op in fallback mode", () => {
    const { result } = renderHook(() => useOutlineInstanceState(null, null));
    expect(() => act(() => result.current.restoreScrollTo(null))).not.toThrow();
  });
});
