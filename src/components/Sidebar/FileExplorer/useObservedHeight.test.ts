/**
 * The measured height must not oscillate between two boxes.
 *
 * Regression guard for the file explorer's dead mouse clicks (issue #1187, and
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
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useObservedHeight } from "./useObservedHeight";

const BORDER_BOX = 909;
const CONTENT_BOX = 901; // 909 - 4px padding-top - 4px padding-bottom

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

function makeElement(): HTMLElement {
  const el = document.createElement("div");
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
  it("reports the element height on attach", () => {
    const { result } = renderHook(() => useObservedHeight<HTMLElement>());
    const el = makeElement();
    act(() => result.current[0](el));
    expect(result.current[1]).toBe(BORDER_BOX);
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

    expect(result.current[1]).toBe(BORDER_BOX);
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

    expect(result.current[1]).toBe(500);
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
