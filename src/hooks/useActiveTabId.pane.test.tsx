import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));

import { useActiveTabId } from "./useDocumentState";
import { useTabStore } from "@/stores/tabStore";
import { usePaneStore } from "@/stores/paneStore";
import { PaneProvider } from "@/contexts/PaneContext";

const W = "main";

beforeEach(() => {
  useTabStore.setState({ activeTabId: { [W]: "primary-tab" } } as never);
  usePaneStore.setState({ byWindow: {} });
});

describe("useActiveTabId — pane awareness (#1081)", () => {
  it("returns the primary active tab when no split is open (single-pane unchanged)", () => {
    const { result } = renderHook(() => useActiveTabId());
    expect(result.current).toBe("primary-tab");
  });

  it("returns the primary tab when split is open but primary is focused", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab");
    usePaneStore.getState().setFocusedPane(W, "primary");
    const { result } = renderHook(() => useActiveTabId());
    expect(result.current).toBe("primary-tab");
  });

  it("returns the secondary tab when the secondary pane is focused", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // focuses secondary
    const { result } = renderHook(() => useActiveTabId());
    expect(result.current).toBe("secondary-tab");
  });

  it("returns THIS pane's tab when rendered inside a PaneProvider, ignoring focus", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // focus = secondary
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PaneProvider value={{ paneId: "primary", tabId: "my-pane-tab" }}>{children}</PaneProvider>
    );
    const { result } = renderHook(() => useActiveTabId(), { wrapper });
    // Even though the window's focused pane is the secondary tab, a subtree
    // inside the primary PaneProvider resolves to its own tab.
    expect(result.current).toBe("my-pane-tab");
  });
});
