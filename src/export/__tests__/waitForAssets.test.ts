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

    it("does not throw when the Font Loading API is missing (Codex audit)", () => {
      // waitForFonts already treats a missing document.fonts as "ready";
      // the polling path must be equally defensive or every poll tick throws
      // in environments without the CSS Font Loading API.
      Object.defineProperty(document, "fonts", {
        configurable: true,
        value: undefined,
      });
      expect(() => getStabilityStatus(container)).not.toThrow();
      expect(getStabilityStatus(container).fontsReady).toBe(true);
    });

    it("reports fonts not ready while the Font Loading API is still loading", () => {
      Object.defineProperty(document, "fonts", {
        configurable: true,
        value: { status: "loading", ready: Promise.resolve() },
      });
      expect(getStabilityStatus(container).fontsReady).toBe(false);
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

  describe("diagram readiness (mermaid + graphviz loading placeholders)", () => {
    it("flags a container with a pending mermaid render as not ready", () => {
      const container = document.createElement("div");
      const el = document.createElement("div");
      el.className = "code-block-preview mermaid-preview mermaid-loading";
      container.appendChild(el);

      const status = getStabilityStatus(container);
      expect(status.mermaidReady).toBe(false);
      expect(status.allReady).toBe(false);
    });

    it("flags a container with a pending graphviz render as not ready", () => {
      const container = document.createElement("div");
      const el = document.createElement("div");
      el.className = "code-block-preview graphviz-preview graphviz-loading";
      container.appendChild(el);

      const status = getStabilityStatus(container);
      expect(status.mermaidReady).toBe(false);
      expect(status.allReady).toBe(false);
    });

    it("treats rendered diagrams (no loading class) as ready", () => {
      const container = document.createElement("div");
      const el = document.createElement("div");
      el.className = "code-block-preview graphviz-preview";
      container.appendChild(el);

      expect(getStabilityStatus(container).mermaidReady).toBe(true);
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

    // Audit 20260907 (#348): `document.fonts.ready` was awaited BEFORE the
    // bounded poll, outside `timeout` — a font load that never settles kept the
    // export promise pending forever. The wait is now raced against the deadline.
    it("a font load that never settles cannot outlive the timeout", async () => {
      vi.useFakeTimers();
      try {
        Object.defineProperty(document, "fonts", {
          configurable: true,
          value: { status: "loading", ready: new Promise<void>(() => {}) },
        });
        const settle = vi.fn();
        waitForAssets(container, { timeout: 1000, interval: 10 }).then(settle);

        await vi.advanceTimersByTimeAsync(990);
        expect(settle).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(20);
        await Promise.resolve();
        expect(settle).toHaveBeenCalledTimes(1);
        const result = settle.mock.calls[0][0];
        expect(result.success).toBe(false);
        expect(result.status.fontsReady).toBe(false);
        expect(result.warnings).toContain("Fonts did not finish loading");
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

  // Audit 20260907 — four gaps in the readiness gate.
  describe("readiness gates (audit 20260907)", () => {
    // #349: math readiness keyed on the English placeholder TEXT ("rendering",
    // "math"), so a localized placeholder read as ready and the error state
    // ("Failed to render math") waited out the timeout. The lifecycle CLASSES
    // are the signal.
    it("a pending LaTeX placeholder is not ready whatever its text says", () => {
      container.innerHTML =
        '<div class="code-block-preview latex-preview code-block-preview-placeholder">渲染中…</div>';
      expect(getStabilityStatus(container).mathReady).toBe(false);
    });

    it("a terminal math error is ready even though its text mentions math", () => {
      container.innerHTML =
        '<div class="code-block-preview latex-preview mermaid-error">Failed to render math</div>';
      expect(getStabilityStatus(container).mathReady).toBe(true);
    });

    it("a non-math placeholder does not hold the math gate", () => {
      container.innerHTML =
        '<div class="code-block-preview svg-preview code-block-preview-placeholder">Rendering math…</div>';
      expect(getStabilityStatus(container).mathReady).toBe(true);
    });

    // #352: an exception from onProgress inside the timer-driven poll escaped
    // the callback and left the promise pending forever.
    it("an onProgress that throws does not leave the wait pending", async () => {
      vi.useFakeTimers();
      try {
        const settle = vi.fn();
        waitForAssets(container, {
          timeout: 1000,
          interval: 10,
          onProgress: () => {
            throw new Error("consumer bug");
          },
        }).then(settle);
        await vi.runAllTimersAsync();
        await Promise.resolve();
        expect(settle).toHaveBeenCalledTimes(1);
        expect(settle.mock.calls[0][0].success).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    // #353: readiness was captured before the two settling frames and never
    // rechecked, so an asset invalidated during layout still produced success.
    it("re-checks after the settling frames and keeps polling when readiness was lost", async () => {
      vi.useFakeTimers();
      try {
        const img = makeImg("asset://localhost/foo.png", true);
        container.append(img);
        const settle = vi.fn();
        waitForAssets(container, { timeout: 1000, interval: 10 }).then(settle);
        // The first check has run and the frames are pending; now the image
        // is replaced by one still resolving.
        for (let i = 0; i < 5; i++) await Promise.resolve();
        img.setAttribute("src", "");
        await vi.runAllTimersAsync();
        await Promise.resolve();
        expect(settle).toHaveBeenCalledTimes(1);
        const result = settle.mock.calls[0][0];
        expect(result.success).toBe(false);
        expect(result.warnings).toContain("1 image(s) did not load");
      } finally {
        vi.useRealTimers();
      }
    });

    // #354: once ready, the double-requestAnimationFrame path ignored the
    // timeout — throttled or suspended frames hung the export.
    it("resolves by the deadline when animation frames never arrive", async () => {
      vi.useFakeTimers();
      const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
      try {
        const settle = vi.fn();
        waitForAssets(container, { timeout: 500, interval: 10 }).then(settle);
        await vi.advanceTimersByTimeAsync(490);
        expect(settle).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(20);
        await Promise.resolve();
        expect(settle).toHaveBeenCalledTimes(1);
        expect(settle.mock.calls[0][0].success).toBe(true);
      } finally {
        raf.mockRestore();
        vi.useRealTimers();
      }
    });

    // #354, round 2: the deadline fallback returned `success: true` without
    // looking — a timed-out wait during which an asset was invalidated shipped
    // as a success, the very thing the re-check after the frames (#353) exists
    // to refuse. The deadline reports what it finds, like the poll's own timeout.
    it("a deadline that finds the assets no longer ready reports failure and what is pending", async () => {
      vi.useFakeTimers();
      const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
      try {
        const img = makeImg("asset://localhost/foo.png", true);
        container.append(img);
        const settle = vi.fn();
        waitForAssets(container, { timeout: 500, interval: 10 }).then(settle);
        // The first check saw a ready document and is waiting on frames that
        // never come; the image is then replaced by one still resolving.
        for (let i = 0; i < 5; i++) await Promise.resolve();
        img.setAttribute("src", "");

        await vi.advanceTimersByTimeAsync(510);
        await Promise.resolve();
        expect(settle).toHaveBeenCalledTimes(1);
        const result = settle.mock.calls[0][0];
        expect(result.success).toBe(false);
        expect(result.status.imagesReady).toBe(false);
        expect(result.warnings).toContain("Layout did not settle before the deadline");
        expect(result.warnings).toContain("1 image(s) did not load");
      } finally {
        raf.mockRestore();
        vi.useRealTimers();
      }
    });
  });
});

// Audit 20260907 round 3 (#707/#709). The numeric options were taken on trust:
// `timeout: NaN` makes `elapsed >= timeout` false forever, so the poll that is
// documented to be bounded never ends; a non-positive interval schedules the
// next poll with no gap at all. And even a valid interval was always waited in
// FULL, so an interval larger than the remaining budget overshot the deadline
// the caller asked for.
describe("waitForAssets — the deadline is a bound, not a suggestion", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it.each([NaN, Infinity, -1])("a timeout of %s still terminates", async (timeout) => {
    vi.useFakeTimers();
    try {
      const img = makeImg("", true);
      container.append(img);
      const settle = vi.fn();
      void waitForAssets(container, { timeout, interval: 10 }).then(settle);

      // The documented default is 10s; nothing may outlive it.
      await vi.advanceTimersByTimeAsync(10_050);
      await Promise.resolve();
      expect(settle).toHaveBeenCalledTimes(1);
      expect(settle.mock.calls[0][0].success).toBe(false);
      expect(settle.mock.calls[0][0].warnings).toContain(
        "Ignored an unusable timeout/interval option; used the defaults",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("a non-positive interval does not become a busy loop", async () => {
    vi.useFakeTimers();
    try {
      container.append(makeImg("", true));
      const settle = vi.fn();
      const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
      void waitForAssets(container, { timeout: 500, interval: 0 }).then(settle);

      await vi.advanceTimersByTimeAsync(600);
      await Promise.resolve();
      expect(settle).toHaveBeenCalledTimes(1);
      // 500ms at the documented 100ms default is a handful of polls, not
      // thousands of zero-delay ones.
      expect(timeoutSpy.mock.calls.length).toBeLessThan(30);
      timeoutSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never waits past the deadline just because the interval is larger (#709)", async () => {
    vi.useFakeTimers();
    try {
      container.append(makeImg("", true));
      const settle = vi.fn();
      void waitForAssets(container, { timeout: 300, interval: 5000 }).then(settle);

      await vi.advanceTimersByTimeAsync(320);
      await Promise.resolve();
      expect(settle).toHaveBeenCalledTimes(1);
      expect(settle.mock.calls[0][0].success).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
