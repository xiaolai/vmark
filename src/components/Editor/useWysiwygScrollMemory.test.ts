import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearEditorScrollOffsets,
  getEditorScrollOffset,
} from "@/services/editor/scrollPosition";
import { useWysiwygScrollMemory } from "./useWysiwygScrollMemory";

/** A scrollable stand-in: jsdom reports 0 for every layout-derived property. */
function makeScroller(): HTMLElement {
  const el = document.createElement("div");
  el.style.overflowY = "auto";
  Object.defineProperty(el, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 500, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: 0, writable: true, configurable: true });
  document.body.appendChild(el);
  return el;
}

/** The wrapper div TiptapEditorInner owns, mounted inside the scroller. */
function makeContainerRef(scroller: HTMLElement) {
  const wrapper = document.createElement("div");
  scroller.appendChild(wrapper);
  return { current: wrapper };
}

let scroller: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  clearEditorScrollOffsets("tab-1");
  scroller = makeScroller();
});

afterEach(() => {
  vi.useRealTimers();
  scroller.remove();
});

describe("useWysiwygScrollMemory", () => {
  it("records the tab's scroll offset while the editor is visible", () => {
    renderHook(() => useWysiwygScrollMemory(makeContainerRef(scroller), "tab-1", true));

    scroller.scrollTop = 725;
    scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(200);

    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBe(725);
  });

  it("keeps the last offset on unmount, then stops listening", () => {
    const { unmount } = renderHook(() =>
      useWysiwygScrollMemory(makeContainerRef(scroller), "tab-1", true),
    );

    scroller.scrollTop = 512;
    scroller.dispatchEvent(new Event("scroll"));
    unmount(); // a tab switch inside the throttle window

    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBe(512);

    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(200);
    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBe(512);
  });

  it("records nothing while disabled (hidden or split preview)", () => {
    renderHook(() => useWysiwygScrollMemory(makeContainerRef(scroller), "tab-1", false));

    scroller.scrollTop = 300;
    scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(200);

    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBeUndefined();
  });

  it("is inert when the wrapper ref has not been attached yet", () => {
    expect(() =>
      renderHook(() => useWysiwygScrollMemory({ current: null }, "tab-1", true)),
    ).not.toThrow();
    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBeUndefined();
  });

  it("never reaches into the editor view — a thrown getter would kill the surface", () => {
    // Tiptap v3 proxies `editor.view` while unmounted and THROWS on every
    // property access. Resolving the container from the ref is what keeps this
    // hook out of that blast radius; nothing here may touch a Tiptap object.
    const src = useWysiwygScrollMemory.toString();
    expect(src).not.toMatch(/\.view\b/);
    expect(src).not.toMatch(/\.dom\b/);
  });
});
