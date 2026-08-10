// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelEditorScrollRestore,
  clearEditorScrollOffsets,
  findScrollContainer,
  getEditorScrollOffset,
  restoreEditorScroll,
  setEditorScrollOffset,
  trackEditorScroll,
} from "./scrollPosition";

/** A scroll container stand-in. jsdom has no layout, so the real DOM would not
 *  model clamping either — `max` is what makes the clamp observable. */
function makeListeners() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, fn: () => void) {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      set.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    emit(type: string) {
      listeners.get(type)?.forEach((fn) => fn());
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

/** Stands in for `container.ownerDocument`, where gesture listeners go. */
function makeDocument() {
  return makeListeners();
}

function makeContainer(opts: { scrollHeight?: number; clientHeight?: number; max?: number } = {}) {
  const listeners = new Map<string, Set<() => void>>();
  let top = 0;
  const el = {
    scrollHeight: opts.scrollHeight ?? 2000,
    clientHeight: opts.clientHeight ?? 500,
    max: opts.max ?? Number.POSITIVE_INFINITY,
    ownerDocument: null as ReturnType<typeof makeDocument> | null,
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.min(value, el.max);
    },
    addEventListener(type: string, fn: () => void) {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      set.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    emit(type: string) {
      listeners.get(type)?.forEach((fn) => fn());
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
  return el;
}

type FakeContainer = ReturnType<typeof makeContainer>;
const asElement = (el: FakeContainer) => el as unknown as HTMLElement;

/** Run `body` with a synchronous requestAnimationFrame, reporting frame count. */
function withSyncRaf(body: (frames: () => number) => void): void {
  let calls = 0;
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    calls += 1;
    cb(0);
    return calls;
  }) as typeof globalThis.requestAnimationFrame;
  try {
    body(() => calls);
  } finally {
    globalThis.requestAnimationFrame = original;
  }
}

beforeEach(() => {
  clearEditorScrollOffsets("tab-1");
  clearEditorScrollOffsets("tab-2");
});

describe("editor scroll offset memory", () => {
  it("returns undefined for a tab that was never recorded", () => {
    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBeUndefined();
  });

  it("records offsets per surface, independently", () => {
    setEditorScrollOffset("tab-1", "wysiwyg", 420);
    setEditorScrollOffset("tab-1", "source", 77);
    setEditorScrollOffset("tab-2", "wysiwyg", 9);

    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBe(420);
    expect(getEditorScrollOffset("tab-1", "source")).toBe(77);
    expect(getEditorScrollOffset("tab-2", "wysiwyg")).toBe(9);
    expect(getEditorScrollOffset("tab-2", "source")).toBeUndefined();
  });

  it("drops every surface for a tab on clear", () => {
    setEditorScrollOffset("tab-1", "wysiwyg", 420);
    setEditorScrollOffset("tab-1", "source", 77);

    clearEditorScrollOffsets("tab-1");

    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBeUndefined();
    expect(getEditorScrollOffset("tab-1", "source")).toBeUndefined();
  });

  it("ignores writes with no tab, a negative offset, or a non-finite offset", () => {
    setEditorScrollOffset(undefined, "wysiwyg", 100);
    setEditorScrollOffset(null, "wysiwyg", 100);
    setEditorScrollOffset("tab-1", "wysiwyg", -1);
    setEditorScrollOffset("tab-1", "wysiwyg", Number.NaN);

    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBeUndefined();
  });

  it("reads nothing for a missing tab id", () => {
    expect(getEditorScrollOffset(undefined, "wysiwyg")).toBeUndefined();
  });
});

describe("trackEditorScroll", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("records the offset after the throttle window", () => {
    const el = makeContainer();
    const stop = trackEditorScroll(asElement(el), "tab-1", "wysiwyg");

    el.scrollTop = 300;
    el.emit("scroll");
    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBeUndefined();

    vi.advanceTimersByTime(200);
    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBe(300);

    stop();
  });

  it("keeps the LAST offset of a throttle window, not the first", () => {
    const el = makeContainer();
    const stop = trackEditorScroll(asElement(el), "tab-1", "wysiwyg");

    el.scrollTop = 100;
    el.emit("scroll");
    el.scrollTop = 900;
    el.emit("scroll");
    vi.advanceTimersByTime(200);

    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBe(900);
    stop();
  });

  it("ignores scroll events fired while the container cannot scroll", () => {
    // The teardown path that made this necessary: switching to Source mode
    // flips .editor-content to overflow:hidden and resets it to 0, which
    // fires a scroll event the reader never asked for.
    const el = makeContainer({ scrollHeight: 500, clientHeight: 500 });
    const stop = trackEditorScroll(asElement(el), "tab-1", "wysiwyg");

    el.scrollTop = 0;
    el.emit("scroll");
    vi.advanceTimersByTime(200);

    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBeUndefined();
    stop();
  });

  it("discards a capture taken just BEFORE a restore started", () => {
    // The exact live failure, caught by probe: the caret scroll is captured a
    // moment before the restore begins and written by the throttle 150ms later,
    // from inside it — `[SCROLLPOS] write wysiwyg 16591 restoring=true`. The
    // remembered 8000 was overwritten with the container's maximum, and the
    // reader walked to the bottom of the document on the next switch.
    const el = makeContainer();
    setEditorScrollOffset("tab-1", "wysiwyg", 8000);
    const stop = trackEditorScroll(asElement(el), "tab-1", "wysiwyg");

    el.scrollTop = 16591; // focus() drags the caret into view
    el.emit("scroll"); // captured — no restore is running yet

    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 1) as typeof globalThis.requestAnimationFrame;
    restoreEditorScroll(asElement(el), 8000); // ...and now one starts
    vi.advanceTimersByTime(200); // the throttle fires mid-restore

    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBe(8000);

    cancelEditorScrollRestore();
    globalThis.requestAnimationFrame = originalRaf;
    stop();
  });

  it("ignores scroll events fired while a restore is in flight", () => {
    // Measured live: the caret scroll that `view.focus()` performs during a
    // restore was recorded as the reader's position, so the remembered offset
    // overwrote itself with 0 in a single tab round trip.
    const el = makeContainer();
    setEditorScrollOffset("tab-1", "wysiwyg", 8000);
    const stop = trackEditorScroll(asElement(el), "tab-1", "wysiwyg");

    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (() => 1) as typeof globalThis.requestAnimationFrame; // hold the restore open
    restoreEditorScroll(asElement(el), 8000);

    el.scrollTop = 0; // focus() drags the caret into view
    el.emit("scroll");
    vi.advanceTimersByTime(200);

    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBe(8000);

    cancelEditorScrollRestore();
    globalThis.requestAnimationFrame = originalRaf;
    stop();
  });

  it("resumes recording once the restore is done", () => {
    const el = makeContainer();
    const stop = trackEditorScroll(asElement(el), "tab-1", "wysiwyg");

    withSyncRaf(() => restoreEditorScroll(asElement(el), 800));
    el.scrollTop = 1234; // the reader, afterwards
    el.emit("scroll");
    vi.advanceTimersByTime(200);

    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBe(1234);
    stop();
  });

  it("flushes the pending offset and detaches on stop", () => {
    const el = makeContainer();
    const stop = trackEditorScroll(asElement(el), "tab-1", "wysiwyg");

    el.scrollTop = 640;
    el.emit("scroll");
    stop(); // unmount lands inside the throttle window

    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBe(640);
    expect(el.listenerCount("scroll")).toBe(0);

    // A late scroll after teardown must not reach the store.
    el.scrollTop = 12;
    el.emit("scroll");
    vi.advanceTimersByTime(200);
    expect(getEditorScrollOffset("tab-1", "wysiwyg")).toBe(640);
  });

  it("is a no-op without a container or a tab", () => {
    expect(() => trackEditorScroll(null, "tab-1", "wysiwyg")()).not.toThrow();
    const el = makeContainer();
    expect(() => trackEditorScroll(asElement(el), undefined, "wysiwyg")()).not.toThrow();
    expect(el.listenerCount("scroll")).toBe(0);
  });
});

describe("restoreEditorScroll", () => {
  it("writes 0 unconditionally when there is no saved position", () => {
    const el = makeContainer();
    el.scrollTop = 250;

    withSyncRaf(() => restoreEditorScroll(asElement(el), 0));

    expect(el.scrollTop).toBe(0);
  });

  it("restores the saved offset", () => {
    const el = makeContainer();

    withSyncRaf(() => restoreEditorScroll(asElement(el), 800));

    expect(el.scrollTop).toBe(800);
  });

  it("waits for late content instead of clamping against an unfinished height", () => {
    // Measured in the real app: the surface remounts reporting scrollHeight
    // 1330 and the true 19464 arrives ~570ms (≈34 frames) later. A restore that
    // gave up after 12 frames wrote 0 and stayed there.
    const el = makeContainer({ scrollHeight: 1330, clientHeight: 1330, max: 0 });

    withSyncRaf((frames) => {
      const original = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        if (frames() >= 34) {
          el.scrollHeight = 19464; // content finally laid out
          el.max = Number.POSITIVE_INFINITY;
        }
        return original(cb);
      }) as typeof globalThis.requestAnimationFrame;
      restoreEditorScroll(asElement(el), 8000);
      globalThis.requestAnimationFrame = original;
    });

    expect(el.scrollTop).toBe(8000);
  });

  it("holds the position against a later scroll it did not make", () => {
    // Measured in WebKit: view.focus() slams the container to its maximum a
    // few frames in, then the caret reset drops it to 0. Neither is the reader.
    const el = makeContainer();
    let frame = 0;

    withSyncRaf(() => {
      const original = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        frame += 1;
        if (frame === 2) el.scrollTop = 1500; // focus() scrolls the caret into view
        if (frame === 4) el.scrollTop = 0; // caret reset to the document start
        return original(cb);
      }) as typeof globalThis.requestAnimationFrame;
      restoreEditorScroll(asElement(el), 800);
      globalThis.requestAnimationFrame = original;
    });

    expect(el.scrollTop).toBe(800);
  });

  it("stands down when told the viewport has a new owner", () => {
    const el = makeContainer();
    let frame = 0;

    withSyncRaf(() => {
      const original = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        frame += 1;
        if (frame === 2) {
          cancelEditorScrollRestore(); // a heading-fragment jump takes over
          el.scrollTop = 120;
        }
        return original(cb);
      }) as typeof globalThis.requestAnimationFrame;
      restoreEditorScroll(asElement(el), 800);
      globalThis.requestAnimationFrame = original;
    });

    expect(el.scrollTop).toBe(120);
  });

  it("gives up at the frame ceiling, landing at the end of a shortened document", () => {
    const el = makeContainer({ scrollHeight: 560, clientHeight: 500, max: 60 });

    withSyncRaf((frames) => {
      restoreEditorScroll(asElement(el), 800);
      expect(frames()).toBeLessThanOrEqual(90);
    });

    expect(el.scrollTop).toBe(60);
  });

  it("stands down when the reader makes an input gesture", () => {
    const el = makeContainer({ scrollHeight: 1330, clientHeight: 1330, max: 0 });
    const doc = makeDocument();
    el.ownerDocument = doc;

    withSyncRaf((frames) => {
      const original = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        if (frames() === 3) doc.emit("wheel"); // reader takes over while we wait
        if (frames() >= 5) {
          el.scrollHeight = 19464;
          el.max = Number.POSITIVE_INFINITY;
        }
        return original(cb);
      }) as typeof globalThis.requestAnimationFrame;
      restoreEditorScroll(asElement(el), 8000);
      globalThis.requestAnimationFrame = original;
    });

    expect(el.scrollTop).toBe(0);
    expect(doc.listenerCount("wheel")).toBe(0); // and it cleans up after itself
  });

  it("does NOT read reader intent from position — the browser scrolls too", () => {
    // Regression guard. An earlier version stood down whenever the container
    // sat past the target. WebKit's scroll-caret-into-view after focus() does
    // exactly that on the first frame, so the restore aborted before running
    // and the reported bug survived the fix. Only a gesture may stand it down.
    const el = makeContainer();
    let frame = 0;

    withSyncRaf(() => {
      const original = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        frame += 1;
        if (frame === 1) el.scrollTop = 1200; // browser scrolled past the target
        return original(cb);
      }) as typeof globalThis.requestAnimationFrame;
      restoreEditorScroll(asElement(el), 800);
      globalThis.requestAnimationFrame = original;
    });

    expect(el.scrollTop).toBe(800);
  });

  it("is a no-op without a container", () => {
    expect(() => restoreEditorScroll(null, 300)).not.toThrow();
  });
});

describe("findScrollContainer", () => {
  const styles = new Map<object, string>();
  const original = globalThis.getComputedStyle;

  beforeEach(() => {
    styles.clear();
    globalThis.getComputedStyle = ((el: object) =>
      ({ overflowY: styles.get(el) ?? "visible" }) as CSSStyleDeclaration) as typeof globalThis.getComputedStyle;
  });
  afterEach(() => {
    globalThis.getComputedStyle = original;
  });

  it("returns the nearest ancestor that scrolls", () => {
    const scroller = { parentElement: null };
    const middle = { parentElement: scroller };
    const dom = { parentElement: middle };
    styles.set(scroller, "auto");

    expect(findScrollContainer(dom as unknown as HTMLElement)).toBe(scroller);
  });

  it("accepts overflow:scroll as well as auto", () => {
    const scroller = { parentElement: null };
    const dom = { parentElement: scroller };
    styles.set(scroller, "scroll");

    expect(findScrollContainer(dom as unknown as HTMLElement)).toBe(scroller);
  });

  it("falls back to the direct parent when no ancestor scrolls", () => {
    const grandparent = { parentElement: null };
    const parent = { parentElement: grandparent };
    const dom = { parentElement: parent };

    expect(findScrollContainer(dom as unknown as HTMLElement)).toBe(parent);
  });

  it("falls back to the direct parent when getComputedStyle throws", () => {
    globalThis.getComputedStyle = (() => {
      throw new Error("no layout here");
    }) as typeof globalThis.getComputedStyle;
    const parent = { parentElement: null };
    const dom = { parentElement: parent };

    expect(findScrollContainer(dom as unknown as HTMLElement)).toBe(parent);
  });

  it("returns null for no element", () => {
    expect(findScrollContainer(null)).toBeNull();
  });
});
