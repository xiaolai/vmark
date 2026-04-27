/**
 * Tests for waitForAssets — focused on the empty-src race that surfaced in
 * issue #837 (relative-path images rendered as broken placeholders in
 * exported PDFs).
 *
 * Background: ImageNodeView (used by ExportSurface) sets `dom.src = ""`
 * synchronously, then resolves the real `asset://` URL asynchronously.
 * Browsers report `img.complete === true` for an empty src, so a naive
 * stability check would return immediately and the exporter would extract
 * HTML containing `<img src="">`, which `resourceResolver` cannot resolve.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getStabilityStatus,
  isImageSettled,
  waitForAllImages,
  waitForAssets,
} from "../waitForAssets";

// jsdom doesn't ship the CSS Font Loading API. Force-install a deterministic
// stub for every test (and restore it afterwards) so suite behaviour doesn't
// depend on whatever may already be on `document.fonts` in the host env.
const originalFontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");

beforeEach(() => {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      status: "loaded",
      ready: Promise.resolve(),
    },
  });
});

afterEach(() => {
  if (originalFontsDescriptor) {
    Object.defineProperty(document, "fonts", originalFontsDescriptor);
  } else {
    // Fully unrooted in jsdom — drop the stub so the next file starts clean.
    delete (document as unknown as { fonts?: unknown }).fonts;
  }
});

// jsdom's HTMLImageElement reports `complete === true` synchronously for any
// src — including empty — so we need a tiny shim to model the real browser
// behaviour where setting a non-empty src starts the load but completion only
// happens once an event fires.
function makeImg(
  src: string,
  complete: boolean,
  opts: { errored?: boolean } = {},
): HTMLImageElement {
  const img = document.createElement("img");
  if (src) img.setAttribute("src", src);
  if (opts.errored) img.classList.add("image-error");
  Object.defineProperty(img, "complete", {
    configurable: true,
    get: () => complete,
  });
  return img;
}

describe("waitForAssets — image stability", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  describe("isImageSettled", () => {
    it("returns false for empty src (NodeView still resolving)", () => {
      expect(isImageSettled(makeImg("", true))).toBe(false);
    });

    it("returns false when src is set but the asset is still loading", () => {
      expect(isImageSettled(makeImg("asset://localhost/foo.png", false))).toBe(false);
    });

    it("returns true for a fully loaded image", () => {
      expect(isImageSettled(makeImg("asset://localhost/foo.png", true))).toBe(true);
    });

    it("returns true for an image marked as terminal error, even with empty src", () => {
      // ImageNodeView leaves src="" then adds .image-error after a failed
      // resolve. Without recognising this, the poller would run until
      // timeout (~5–10s) for every broken image — bad UX in long docs.
      expect(isImageSettled(makeImg("", true, { errored: true }))).toBe(true);
    });

    it("returns true for an errored image regardless of complete state", () => {
      expect(isImageSettled(makeImg("", false, { errored: true }))).toBe(true);
    });
  });

  describe("getStabilityStatus", () => {
    it("flags an image with empty src as not ready", () => {
      // Mirrors ImageNodeView's initial state during async resolution.
      container.append(makeImg("", true));
      expect(getStabilityStatus(container).imagesReady).toBe(false);
    });

    it("flags an unloaded image (src set, not complete) as not ready", () => {
      container.append(makeImg("asset://localhost/foo.png", false));
      expect(getStabilityStatus(container).imagesReady).toBe(false);
    });

    it("treats an image with a real src that has loaded as ready", () => {
      container.append(makeImg("asset://localhost/foo.png", true));
      expect(getStabilityStatus(container).imagesReady).toBe(true);
    });

    it("treats an errored image (empty src + .image-error) as ready", () => {
      // Regression guard: without this, broken images would block export
      // until the full timeout instead of failing fast.
      container.append(makeImg("", true, { errored: true }));
      expect(getStabilityStatus(container).imagesReady).toBe(true);
    });

    it("returns ready when there are no images", () => {
      expect(getStabilityStatus(container).imagesReady).toBe(true);
    });

    it("requires every image to be ready", () => {
      container.append(makeImg("asset://localhost/foo.png", true));
      container.append(makeImg("", true)); // still pending resolution
      expect(getStabilityStatus(container).imagesReady).toBe(false);
    });

    it("settles when one image loaded and the other errored terminally", () => {
      container.append(makeImg("asset://localhost/foo.png", true));
      container.append(makeImg("", true, { errored: true }));
      expect(getStabilityStatus(container).imagesReady).toBe(true);
    });
  });

  describe("waitForAllImages", () => {
    it("resolves immediately when there are no images", async () => {
      await expect(waitForAllImages(container, 50)).resolves.toBe(true);
    });

    it("resolves immediately when all images are loaded with a real src", async () => {
      container.append(makeImg("asset://localhost/foo.png", true));
      await expect(waitForAllImages(container, 50)).resolves.toBe(true);
    });

    it("waits for the load event when src is set but not yet complete", async () => {
      const img = makeImg("asset://localhost/foo.png", false);
      container.append(img);

      const pending = waitForAllImages(container, 200);
      img.dispatchEvent(new Event("load"));
      await expect(pending).resolves.toBe(true);
    });

    it("waits for the load event even when src starts empty (NodeView resolution race)", async () => {
      // Empty src + complete=true would pass the naive check and resolve
      // synchronously without the fix. The waiter must instead attach a
      // listener and wait for the NodeView to finish resolving.
      const img = makeImg("", true);
      container.append(img);

      const pending = waitForAllImages(container, 200);

      // Simulate ImageNodeView finishing async resolution: set the real src
      // then fire the load event the way the browser would.
      img.setAttribute("src", "asset://localhost/foo.png");
      img.dispatchEvent(new Event("load"));

      await expect(pending).resolves.toBe(true);
    });

    it("returns false when an image never loads within the timeout", async () => {
      vi.useFakeTimers();
      try {
        container.append(makeImg("", true));
        const pending = waitForAllImages(container, 50);
        await vi.advanceTimersByTimeAsync(60);
        await expect(pending).resolves.toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("settles immediately for already-errored images without burning the timeout", async () => {
      vi.useFakeTimers();
      try {
        container.append(makeImg("", true, { errored: true }));
        // 5s timeout would normally mean a pending tick — assert it settles
        // synchronously by advancing only microtasks (not real wall time).
        const pending = waitForAllImages(container, 5000);
        await Promise.resolve();
        await expect(pending).resolves.toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("waitForAssets", () => {
    it("settles fast when every image is in the terminal error state", async () => {
      // End-to-end coverage of the orchestrator (not just the helpers): a
      // page full of broken images must not stall export for the full
      // 10s timeout. We assert success without ever advancing past the
      // configured timeout — if the fix regresses, this test would hang
      // and Vitest would kill it.
      vi.useFakeTimers();
      try {
        container.append(makeImg("", true, { errored: true }));
        container.append(makeImg("", true, { errored: true }));

        const settle = vi.fn();
        waitForAssets(container, { timeout: 10_000, interval: 100 }).then(settle);

        // Drain the two rAFs that gate the success resolve plus any pending
        // microtasks (document.fonts.ready). vi.runAllTimersAsync handles
        // both rAF and the next setTimeout-based interval.
        await vi.runAllTimersAsync();
        await Promise.resolve();

        expect(settle).toHaveBeenCalledTimes(1);
        const result = settle.mock.calls[0][0];
        expect(result.success).toBe(true);
        expect(result.status.imagesReady).toBe(true);
        expect(result.warnings).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not resolve before the empty-src image gets a real src", async () => {
      vi.useFakeTimers();
      try {
        const img = makeImg("", true);
        container.append(img);

        const settle = vi.fn();
        // Tight polling interval keeps the test fast.
        waitForAssets(container, { timeout: 1000, interval: 10 }).then(settle);

        // Advance the clock without resolving the image — the poller must
        // keep waiting because the src is still empty.
        await vi.advanceTimersByTimeAsync(200);
        expect(settle).not.toHaveBeenCalled();

        // Simulate ImageNodeView finishing resolution and the browser firing
        // load. Now the next poll should pass and resolve successfully.
        img.setAttribute("src", "asset://localhost/foo.png");
        await vi.advanceTimersByTimeAsync(50);

        // Two requestAnimationFrame ticks gate the success resolve in
        // waitForAssets; flush them.
        await vi.runAllTimersAsync();
        await Promise.resolve();

        expect(settle).toHaveBeenCalledTimes(1);
        const result = settle.mock.calls[0][0];
        expect(result.success).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
