/**
 * The measured height must not oscillate between two boxes, AND it must be the
 * box the measured element's child is actually laid out into — its CONTENT box.
 *
 * Two bugs meet in this hook, and fixing only the first caused the second.
 *
 * (1) Regression guard for the file explorer's dead mouse clicks (issue #1187, and
 * "clicking a file doesn't open it"). `.file-explorer-tree` has 4px vertical
 * padding with box-sizing: border-box, and this hook measured TWO DIFFERENT
 * boxes:
 *   - the callback-ref path used getBoundingClientRect().height -> BORDER box (909)
 *   - the ResizeObserver path used entries[0].contentRect.height -> CONTENT box (901)
 *
 * FileExplorer passes an INLINE composed callback ref, so React invokes it with
 * null and then the element on EVERY render. Each invocation disconnects and
 * re-creates the observer, and a fresh observe() always fires once — reporting
 * the other box, changing state, and re-rendering. Measured live: ~160
 * ResizeObserver constructions per second and all 16 tree rows torn down and
 * recreated ~60 times a second, forever.
 *
 * The user-visible consequence is that a real mouse click is impossible: the
 * row that receives mousedown is destroyed before mouseup, so WebKit never
 * synthesises a click. Automated tests never caught it because a synthetic
 * element.click() does not need the press and release to share a node.
 *
 * (2) Converging BOTH paths on the border box stopped the oscillation but left
 * the value 8px too large, because the number is handed to <Tree height> and
 * react-arborist stamps it onto a child of the measured element — a child that
 * lives in the CONTENT box. An 885px child inside an 877px content box made
 * `.file-explorer-tree` itself scrollable by exactly its 8px of padding, so the
 * file explorer rendered a SECOND vertical scrollbar beside react-window's real
 * one. Measured in the running app: clientHeight 885, scrollHeight 893.
 *
 * So the invariant is two-sided: both paths must agree (or #1187 returns), and
 * they must agree on the CONTENT box (or the phantom scrollbar returns).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useObservedHeight } from "./useObservedHeight";

const BORDER_BOX = 909;
const CONTENT_BOX = 901; // 909 - 4px padding-top - 4px padding-bottom
const VERTICAL_PADDING = "4px";

let roCallbacks: ResizeObserverCallback[] = [];

class MockResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    roCallbacks.push(cb);
  }
  observe() {
    /* a real observe() fires the callback once — the test drives that explicitly */
  }
  disconnect() {}
  unobserve() {}
}

/**
 * A `.file-explorer-tree` stand-in: box-sizing border-box, no border, 4px of
 * vertical padding. With no border, clientHeight == the border box; the content
 * box is that minus the padding.
 */
function makeElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.paddingTop = VERTICAL_PADDING;
  el.style.paddingBottom = VERTICAL_PADDING;
  el.getBoundingClientRect = () =>
    ({ height: BORDER_BOX, width: 200, top: 0, left: 0, right: 200, bottom: BORDER_BOX, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(el, "clientHeight", { value: BORDER_BOX, configurable: true });
  return el;
}

/** What a real ResizeObserver reports for a padded, border-box element. */
function resizeEntryFor(el: HTMLElement): ResizeObserverEntry {
  return {
    target: el,
    contentRect: { height: CONTENT_BOX, width: 200, top: 0, left: 0, right: 200, bottom: CONTENT_BOX, x: 0, y: 0, toJSON: () => ({}) } as DOMRect,
    borderBoxSize: [{ blockSize: BORDER_BOX, inlineSize: 200 }],
    contentBoxSize: [{ blockSize: CONTENT_BOX, inlineSize: 200 }],
    devicePixelContentBoxSize: [{ blockSize: BORDER_BOX, inlineSize: 200 }],
  } as unknown as ResizeObserverEntry;
}

beforeEach(() => {
  roCallbacks = [];
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useObservedHeight", () => {
  it("reports the CONTENT box on attach — the box a child is laid out into", () => {
    const { result } = renderHook(() => useObservedHeight<HTMLElement>());
    const el = makeElement();
    act(() => result.current[0](el));
    // Border box would be 909, which is 8px taller than the box the child
    // occupies — that surplus is what rendered a second scrollbar.
    expect(result.current[1]).toBe(CONTENT_BOX);
  });

  it("a child sized to the reported height does not overflow the measured element", () => {
    const { result } = renderHook(() => useObservedHeight<HTMLElement>());
    const el = makeElement();
    act(() => result.current[0](el));
    act(() => roCallbacks[0]([resizeEntryFor(el)], {} as ResizeObserver));

    const contentBoxHeight = BORDER_BOX - 2 * parseFloat(VERTICAL_PADDING);
    expect(result.current[1]).toBeLessThanOrEqual(contentBoxHeight);
  });

  it("does not change the height when the observer reports the same element", () => {
    const { result } = renderHook(() => useObservedHeight<HTMLElement>());
    const el = makeElement();
    act(() => result.current[0](el));
    const afterAttach = result.current[1];

    act(() => roCallbacks[0]([resizeEntryFor(el)], {} as ResizeObserver));

    // The ref path and the observer path must agree, or each re-render
    // re-observes, the observer reports the other box, and the loop never ends.
    expect(result.current[1]).toBe(afterAttach);
  });

  it("survives an inline ref being re-invoked (null, then element) without oscillating", () => {
    const { result } = renderHook(() => useObservedHeight<HTMLElement>());
    const el = makeElement();

    // Three renders' worth of FileExplorer's inline composed ref callback.
    for (let i = 0; i < 3; i++) {
      act(() => result.current[0](null));
      act(() => result.current[0](el));
      act(() => roCallbacks[roCallbacks.length - 1]([resizeEntryFor(el)], {} as ResizeObserver));
    }

    expect(result.current[1]).toBe(CONTENT_BOX);
  });

  it("still tracks a genuine resize", () => {
    const { result } = renderHook(() => useObservedHeight<HTMLElement>());
    const el = makeElement();
    act(() => result.current[0](el));

    const grown = {
      target: el,
      contentRect: { height: 492 } as DOMRect,
      borderBoxSize: [{ blockSize: 500, inlineSize: 200 }],
      contentBoxSize: [{ blockSize: 492, inlineSize: 200 }],
    } as unknown as ResizeObserverEntry;
    act(() => roCallbacks[0]([grown], {} as ResizeObserver));

    expect(result.current[1]).toBe(492);
  });

  it("clamps to at least 1 — react-window breaks on height 0", () => {
    const { result } = renderHook(() => useObservedHeight<HTMLElement>());
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ height: 0 }) as DOMRect;
    Object.defineProperty(el, "clientHeight", { value: 0, configurable: true });
    act(() => result.current[0](el));
    expect(result.current[1]).toBe(1);
  });
});
