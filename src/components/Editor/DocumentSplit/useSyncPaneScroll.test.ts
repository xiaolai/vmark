import { describe, it, expect } from "vitest";
import { targetScrollTop, findPaneScroller } from "./useSyncPaneScroll";

function el(scrollHeight: number, clientHeight: number, scrollTop: number): HTMLElement {
  return { scrollHeight, clientHeight, scrollTop } as unknown as HTMLElement;
}

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
