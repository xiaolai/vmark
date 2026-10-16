import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { useFocusedPaneState, useIsFocusedPane } from "./useIsFocusedPane";
import { usePaneStore } from "@/stores/paneStore";
import { useTabStore } from "@/stores/tabStore";
import { PaneProvider } from "@/contexts/PaneContext";
import type { PaneId } from "@/stores/paneStore";

const W = "main";

function paneWrapper(paneId: PaneId) {
  return ({ children }: { children: ReactNode }) => (
    <PaneProvider value={{ paneId, tabId: `${paneId}-tab` }}>{children}</PaneProvider>
  );
}

beforeEach(() => {
  usePaneStore.setState({ byWindow: {} });
  useTabStore.setState({ activeTabId: { [W]: "primary-tab" } } as never);
});

describe("useIsFocusedPane (#1081 — ADR-3 focus gating)", () => {
  it("is true with no split open (single pane always focused)", () => {
    const { result } = renderHook(() => useIsFocusedPane(W));
    expect(result.current).toBe(true);
  });

  it("is true outside any PaneProvider when the focused pane is primary", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab");
    usePaneStore.getState().setFocusedPane(W, "primary");
    const { result } = renderHook(() => useIsFocusedPane(W));
    expect(result.current).toBe(true); // no context ⇒ treated as primary
  });

  it("is false for the primary pane when the secondary pane is focused", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // focuses secondary
    const { result } = renderHook(() => useIsFocusedPane(W), {
      wrapper: paneWrapper("primary"),
    });
    expect(result.current).toBe(false);
  });

  it("is true for the secondary pane when it is focused", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab");
    const { result } = renderHook(() => useIsFocusedPane(W), {
      wrapper: paneWrapper("secondary"),
    });
    expect(result.current).toBe(true);
  });

  it("follows focus when it moves between panes (re-render)", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // focus = secondary
    const { result, rerender } = renderHook(() => useIsFocusedPane(W), {
      wrapper: paneWrapper("primary"),
    });
    expect(result.current).toBe(false);

    usePaneStore.getState().setFocusedPane(W, "primary");
    rerender();
    expect(result.current).toBe(true);
  });
});

describe("useFocusedPaneState (#1554 — the flag for deferred focus)", () => {
  it("keeps one ref whose current value tracks the focused pane", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // focus = secondary
    const { result } = renderHook(() => useFocusedPaneState(W), {
      wrapper: paneWrapper("primary"),
    });
    const ref = result.current.isFocusedPaneRef;
    expect(result.current.isFocusedPane).toBe(false);
    expect(ref.current).toBe(false);

    act(() => usePaneStore.getState().setFocusedPane(W, "primary"));
    // The SAME ref object: a timer captured at mount reads the live value.
    expect(result.current.isFocusedPaneRef).toBe(ref);
    expect(ref.current).toBe(true);
    expect(result.current.isFocusedPane).toBe(true);
  });
});
