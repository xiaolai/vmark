/**
 * loadImageNearViewport — an image node view's `src` is assigned only near
 * the viewport, and the scroller stays busy until the image has settled
 * (#1565). jsdom never loads an image, so `load`/`error` are dispatched here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadImageNearViewport, LOAD_SETTLE_TIMEOUT_MS } from "./loadImageNearViewport";
import { flushNearViewport, resetNearViewportForTest } from "./nearViewport";
import { PENDING_RENDER_ATTR, RENDER_BUSY_ATTR } from "@/utils/settledScroll";
import { installFakeIntersectionObserver, onlyObserver, FakeIntersectionObserver } from "@/test/fakeIntersectionObserver";
import { installFakeAnimationFrames, type FakeAnimationFrames } from "@/test/fakeAnimationFrames";

let frames: FakeAnimationFrames;

/** `.editor-content > .ProseMirror > figure > img`, the shape a block image renders. */
function mountImage() {
  const root = document.createElement("div");
  root.className = "editor-content";
  const pm = document.createElement("div");
  pm.className = "ProseMirror";
  const figure = document.createElement("figure");
  const img = document.createElement("img");
  figure.appendChild(img);
  pm.appendChild(figure);
  root.appendChild(pm);
  document.body.appendChild(root);
  return { root, pm, img, assign: vi.fn(() => { img.src = "asset://localhost/a.png"; }) };
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

beforeEach(() => {
  resetNearViewportForTest();
  document.body.innerHTML = "";
  frames = installFakeAnimationFrames();
  installFakeIntersectionObserver();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadImageNearViewport", () => {
  it("assigns at once outside a scrolling editor (the export surface)", () => {
    const img = document.createElement("img");
    const assign = vi.fn();
    loadImageNearViewport(img, null, assign);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it("does not fetch an image until its block nears the viewport", () => {
    const { pm, img, assign } = mountImage();
    loadImageNearViewport(img, pm, assign);
    expect(assign).not.toHaveBeenCalled();
    expect(img.getAttribute("src")).toBeNull();

    onlyObserver().trigger();
    frames.runFrame();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("keeps the scroller busy until the image loads, so a navigation scroll waits for its height", async () => {
    const { root, pm, img, assign } = mountImage();
    loadImageNearViewport(img, pm, assign);
    onlyObserver().trigger();
    frames.runFrame();
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(true);
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(true);

    img.dispatchEvent(new Event("load"));
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(false);
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(false);
  });

  it("settles on a load error too", async () => {
    const { root, pm, img, assign } = mountImage();
    loadImageNearViewport(img, pm, assign);
    onlyObserver().trigger();
    frames.runFrame();
    img.dispatchEvent(new Event("error"));
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(false);
  });

  it("stops waiting on an image that never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { root, pm, img, assign } = mountImage();
    loadImageNearViewport(img, pm, assign);
    onlyObserver().trigger();
    frames.runFrame();

    vi.advanceTimersByTime(LOAD_SETTLE_TIMEOUT_MS - 1);
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(true);
    vi.advanceTimersByTime(1);
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(false);
  });

  it("never fetches once cancelled (source changed, view destroyed)", () => {
    const { root, pm, img, assign } = mountImage();
    const cancel = loadImageNearViewport(img, pm, assign);
    cancel();
    onlyObserver().trigger();
    frames.runFrame();
    expect(assign).not.toHaveBeenCalled();
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(false);
  });

  it("cancelling a load in flight releases the scroller at once (image deleted or replaced)", async () => {
    const { root, pm, img, assign } = mountImage();
    const cancel = loadImageNearViewport(img, pm, assign);
    onlyObserver().trigger();
    frames.runFrame();
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(true);

    cancel();
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(false);
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(false);
  });

  it("an async assign (path resolution) keeps the scroller busy until the image it assigns has loaded", async () => {
    const { root, pm, img } = mountImage();
    let resolvePath = () => {};
    const assign = vi.fn(() => new Promise<void>((resolve) => {
      resolvePath = () => { img.src = "asset://localhost/a.png"; resolve(); };
    }));
    loadImageNearViewport(img, pm, assign);
    expect(assign).not.toHaveBeenCalled();
    onlyObserver().trigger();
    frames.runFrame();
    expect(assign).toHaveBeenCalledTimes(1);
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(true);

    resolvePath();
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(true); // resolved, still loading

    img.dispatchEvent(new Event("load"));
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(false);
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(false);
  });

  it("cancelling while an async assign is resolving releases the scroller at once", async () => {
    const { root, pm, img } = mountImage();
    const cancel = loadImageNearViewport(img, pm, () => new Promise<void>(() => {}));
    onlyObserver().trigger();
    frames.runFrame();
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(true);

    cancel();
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(false);
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(false);
  });

  it("stops waiting on a path resolution that never answers, so print is never held forever", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { root, pm, img } = mountImage();
    loadImageNearViewport(img, pm, () => new Promise<void>(() => {}));
    onlyObserver().trigger();
    frames.runFrame();

    vi.advanceTimersByTime(LOAD_SETTLE_TIMEOUT_MS - 1);
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(true);
    vi.advanceTimersByTime(1);
    await settle();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(false);
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(false);
  });

  it("the deadline also ends a load wait already started, leaving no listener behind", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { pm, img } = mountImage();
    const removed = vi.spyOn(img, "removeEventListener");
    let resolvePath = () => {};
    loadImageNearViewport(img, pm, () => new Promise<void>((resolve) => {
      resolvePath = () => { img.src = "asset://localhost/a.png"; resolve(); };
    }));
    onlyObserver().trigger();
    frames.runFrame();
    vi.advanceTimersByTime(LOAD_SETTLE_TIMEOUT_MS - 1);
    resolvePath();
    await settle();
    expect(removed).not.toHaveBeenCalledWith("load", expect.anything());

    vi.advanceTimersByTime(1);
    await settle();
    expect(removed).toHaveBeenCalledWith("load", expect.anything());
  });

  it("a resolution answering after the deadline starts no new wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { pm, img } = mountImage();
    const added = vi.spyOn(img, "addEventListener");
    let resolvePath = () => {};
    loadImageNearViewport(img, pm, () => new Promise<void>((resolve) => {
      resolvePath = () => { img.src = "asset://localhost/a.png"; resolve(); };
    }));
    onlyObserver().trigger();
    frames.runFrame();
    vi.advanceTimersByTime(LOAD_SETTLE_TIMEOUT_MS);
    await settle();
    resolvePath();
    await settle();
    expect(added).not.toHaveBeenCalledWith("load", expect.anything());
  });

  it("an error escaping an async assign ends the wait and is reported, not left as an unhandled rejection", async () => {
    const { root, pm, img } = mountImage();
    const reported: Array<() => void> = [];
    const failure = new Error("resolver blew up");
    let fail = () => {};
    loadImageNearViewport(img, pm, () => new Promise<void>((_resolve, reject) => { fail = () => reject(failure); }));
    onlyObserver().trigger();
    frames.runFrame();
    await settle();
    const microtask = vi.spyOn(globalThis, "queueMicrotask").mockImplementation((cb) => { reported.push(cb); });
    fail();
    await settle();
    microtask.mockRestore();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(false);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toThrow(failure);
  });

  it("is forced by a print flush, which waits until the image has loaded", async () => {
    const { pm, img, assign } = mountImage();
    loadImageNearViewport(img, pm, assign);
    let flushed = false;
    const flush = flushNearViewport(pm).then(() => { flushed = true; });
    expect(assign).toHaveBeenCalledTimes(1);
    await settle();
    expect(flushed).toBe(false);

    img.dispatchEvent(new Event("load"));
    await flush;
    expect(flushed).toBe(true);
  });
});
