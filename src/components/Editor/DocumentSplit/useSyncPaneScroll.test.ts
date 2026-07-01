import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { targetScrollTop, findPaneScroller, useSyncPaneScroll } from "./useSyncPaneScroll";

function el(scrollHeight: number, clientHeight: number, scrollTop: number): HTMLElement {
  return { scrollHeight, clientHeight, scrollTop } as unknown as HTMLElement;
}

/** A jsdom div with fixed, scrollable geometry (layout is inert in jsdom). */
function scrollablePane(): HTMLElement {
  const d = document.createElement("div");
  Object.defineProperty(d, "scrollHeight", { value: 200, configurable: true });
  Object.defineProperty(d, "clientHeight", { value: 100, configurable: true });
  d.scrollTop = 0;
  return d;
}
const ref = (el: HTMLElement | null): RefObject<HTMLElement | null> => ({ current: el });

describe("targetScrollTop", () => {
  it("maps the source scroll ratio onto the target's scrollable range", () => {
    // source: 50/100 = 0.5 ratio; target range 300 ⇒ 150.
    expect(targetScrollTop(el(200, 100, 50), el(400, 100, 0))).toBe(150);
  });

  it("maps the bottom of one onto the bottom of the other", () => {
    expect(targetScrollTop(el(200, 100, 100), el(500, 100, 0))).toBe(400);
  });

  it("returns the target's current scrollTop when either side cannot scroll", () => {
    expect(targetScrollTop(el(100, 100, 0), el(400, 100, 25))).toBe(25); // source no range
    expect(targetScrollTop(el(200, 100, 50), el(100, 100, 7))).toBe(7); // target no range
  });
});

describe("findPaneScroller", () => {
  it("returns null for a null pane", () => {
    expect(findPaneScroller(null)).toBeNull();
  });

  it("falls back to the pane itself when no scrollable child is found", () => {
    const pane = document.createElement("div");
    expect(findPaneScroller(pane)).toBe(pane);
  });
});

describe("useSyncPaneScroll — effect + echo guard", () => {
  it("mirrors one pane's scroll ratio onto the other when enabled", () => {
    const a = scrollablePane();
    const b = scrollablePane();
    renderHook(() => useSyncPaneScroll(ref(a), ref(b), true, "k"));

    a.scrollTop = 100; // bottom of A's 100px range
    a.dispatchEvent(new Event("scroll"));
    expect(b.scrollTop).toBe(100); // ratio 1.0 onto B's 100px range
  });

  it("guards against echo: the mirrored scroll doesn't bounce back", () => {
    const a = scrollablePane();
    const b = scrollablePane();
    renderHook(() => useSyncPaneScroll(ref(a), ref(b), true, "k"));

    a.scrollTop = 100;
    a.dispatchEvent(new Event("scroll")); // locks, sets b=100
    // The programmatic write to b would fire b's scroll synchronously in a real
    // browser; simulate it while still locked — A must NOT be driven back.
    b.dispatchEvent(new Event("scroll"));
    expect(a.scrollTop).toBe(100); // unchanged by the echo
  });

  it("does nothing when disabled", () => {
    const a = scrollablePane();
    const b = scrollablePane();
    renderHook(() => useSyncPaneScroll(ref(a), ref(b), false, "k"));

    a.scrollTop = 100;
    a.dispatchEvent(new Event("scroll"));
    expect(b.scrollTop).toBe(0);
  });

  it("detaches listeners on unmount", () => {
    const a = scrollablePane();
    const b = scrollablePane();
    const { unmount } = renderHook(() => useSyncPaneScroll(ref(a), ref(b), true, "k"));
    unmount();

    a.scrollTop = 100;
    a.dispatchEvent(new Event("scroll"));
    expect(b.scrollTop).toBe(0);
  });
});
