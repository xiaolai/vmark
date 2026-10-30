/**
 * Tests for PaneContext: the pane identity a subtree renders in.
 *
 * Covers: outside any provider the hook reports null (the caller falls back to
 * the focused pane), inside one it reports that pane, and the nearest provider
 * wins when panes nest.
 */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { PaneProvider, usePaneContext, type PaneContextValue } from "./PaneContext";

function wrapperFor(...values: PaneContextValue[]) {
  return ({ children }: { children: ReactNode }) =>
    values.reduceRight<ReactNode>((inner, value) => <PaneProvider value={value}>{inner}</PaneProvider>, children);
}

describe("usePaneContext", () => {
  it("returns null outside any pane", () => {
    const { result } = renderHook(() => usePaneContext());
    expect(result.current).toBeNull();
  });

  it("returns the pane a subtree renders in, including an empty pane", () => {
    const { result } = renderHook(() => usePaneContext(), {
      wrapper: wrapperFor({ paneId: "secondary", tabId: null }),
    });
    expect(result.current).toEqual({ paneId: "secondary", tabId: null });
  });

  it("the nearest provider wins", () => {
    const { result } = renderHook(() => usePaneContext(), {
      wrapper: wrapperFor({ paneId: "primary", tabId: "a" }, { paneId: "secondary", tabId: "b" }),
    });
    expect(result.current).toEqual({ paneId: "secondary", tabId: "b" });
  });
});
