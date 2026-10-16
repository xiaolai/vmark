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
